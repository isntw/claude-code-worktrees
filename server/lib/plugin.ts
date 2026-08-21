import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Diagnostic,
  PluginCapability,
  PluginHook,
  PluginParts,
  PluginReport,
  PluginSkill,
  PluginState,
} from '../../shared/types'
import { exec } from './exec'
import { stateDir } from './paths'
import { below, parseVersion } from './requirements'

const NAME = 'ccwt'
const ID = `${NAME}@${NAME}`
const PROBE_MS = 20_000
const INSTALL_MS = 120_000
const CLAUDE_MIN = '2.1.229'
const COMMAND_MAX = 500

interface Installed {
  id: string
  version?: string
  scope?: string
  enabled?: boolean
  installedAt?: string
}

export const sourceDir = (): string => join(stateDir(), 'plugin')

const packageRoot = (): string => process.env.CCWT_ROOT ?? process.cwd()

export const CAPABILITIES: PluginCapability[] = [
  {
    name: 'context',
    title: 'What is running',
    blurb:
      'Every session opens knowing which worktrees this repository has, which service each runs, on which port, and whether it is answering. Updated whenever that changes.',
  },
  {
    name: 'guard',
    title: 'No second dev server',
    blurb:
      'A command that would duplicate a service already listening is refused, and the refusal names the URL to open instead. Derived from your recipe, so it knows nothing about any particular stack.',
  },
  {
    name: 'naming',
    title: 'Sessions named after their worktree',
    blurb:
      'A session working in a worktree is titled after it, and retitled if it moves. A name you typed yourself is never overwritten.',
  },
  {
    name: 'tools',
    title: 'Status and logs on request',
    blurb:
      'A change can be checked against what the running service printed rather than by starting another one. A session can also ask ccwt to start a worktree\u2019s services — ccwt still allocates the port and owns the process. Nothing stops or restarts one.',
  },
  {
    name: 'recipe',
    title: 'A session can write the recipe',
    blurb:
      'A session sitting in your project can read it, work out what a worktree of it needs and store the recipe in ccwt — validated first, and never written into the repository. A recipe already saved is not replaced without being asked.',
  },
]

const SAYS: Record<string, string> = {
  SessionStart: 'names every worktree, its services and their ports as a session opens',
  UserPromptSubmit: 'says what changed when a service starts, stops or moves',
  PreToolUse: 'refuses a command that would duplicate a service already listening',
  SessionEnd: 'forgets what this session was told',
}

interface HooksFile {
  hooks?: Record<string, { matcher?: string }[]>
}

interface Manifest {
  version?: string
  mcpServers?: Record<string, unknown>
}

interface MarketplaceEntry {
  name?: string
  source?: unknown
}

interface Marketplace {
  plugins?: MarketplaceEntry[]
}

async function readJson<T>(path: string): Promise<T | null> {
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (raw === null) return null

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const manifestPath = () => join(packageRoot(), 'plugin', '.claude-plugin', 'plugin.json')

const SKILL_BLURBS: Record<string, string> = {
  'ccwt-recipe-create':
    'how to read a project and write the recipe for it, for plain commands and container stacks alike',
  'ccwt-worktree-verify':
    'how to prove a service serves the project rather than merely holding a port, and what a wrong answer means',
}

async function skills(): Promise<PluginSkill[]> {
  const root = join(packageRoot(), 'plugin', 'skills')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])

  const found: PluginSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!(await stat(join(root, entry.name, 'SKILL.md')).catch(() => null))) continue
    found.push({ name: entry.name, blurb: SKILL_BLURBS[entry.name] ?? '' })
  }

  return found
}

async function parts(): Promise<PluginParts> {
  const declared = await readJson<HooksFile>(join(packageRoot(), 'plugin', 'hooks', 'hooks.json'))
  const manifest = await readJson<Manifest>(manifestPath())

  const hooks: PluginHook[] = []
  for (const [event, matchers] of Object.entries(declared?.hooks ?? {})) {
    for (const entry of matchers) {
      hooks.push({ event, matcher: entry.matcher ?? null, blurb: SAYS[event] ?? '' })
    }
  }

  const listed = await exec('node', [join(packageRoot(), 'plugin', 'mcp', 'server.mjs'), '--tools'], {
    timeoutMs: PROBE_MS,
  }).catch(() => null)

  let tools: string[] = []
  if (listed && listed.code === 0) {
    try {
      tools = JSON.parse(listed.stdout) as string[]
    } catch {
      tools = []
    }
  }

  return {
    marketplace: NAME,
    id: ID,
    hooks,
    servers: Object.keys(manifest?.mcpServers ?? {}),
    tools,
    skills: await skills(),
  }
}

async function missingSource(): Promise<string[]> {
  const root = packageRoot()
  const wanted = [
    join(root, 'plugin'),
    join(root, '.claude-plugin', 'marketplace.json'),
    join(root, 'plugin', 'mcp', 'server.mjs'),
    join(root, 'plugin', 'hooks', 'ccwt.mjs'),
  ]
  const missing: string[] = []

  for (const path of wanted) {
    if (!(await stat(path).catch(() => null))) missing.push(path)
  }

  return missing
}

function absent(missing: string[]): Diagnostic {
  const unbuilt = missing.some((path) => path.endsWith('.mjs'))

  return {
    code: 'plugin.missing-source',
    severity: 'error',
    message: `This copy of ccwt does not carry the plugin it would install — ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not there.`,
    hint: unbuilt
      ? 'The plugin\'s entry points are built from `plugin/src` by `npm run build`. Run that, or reinstall ccwt from a published package.'
      : 'A published package must list `plugin` and `.claude-plugin` in its `files`. Reinstall ccwt, or run it from a checkout.',
  }
}

export function commands(): string[] {
  return [
    `claude plugin marketplace add ${sourceDir()}`,
    `claude plugin marketplace update ${NAME}`,
    `claude plugin install ${ID} --scope user -y`,
  ]
}

async function shippedVersion(): Promise<string> {
  const own = await readJson<Manifest>(join(packageRoot(), 'package.json'))
  return own?.version ?? '0.0.0'
}

async function claude(args: string[], timeoutMs = PROBE_MS) {
  return exec('claude', args, { timeoutMs }).catch(() => null)
}

async function claudeVersion(): Promise<string | null> {
  const result = await claude(['--version'])
  if (!result || result.code !== 0) return null
  return parseVersion(result.stdout || result.stderr)
}

function tooOld(version: string | null): boolean {
  return version !== null && below(version, CLAUDE_MIN)
}

export function pluginCommand(): string {
  return `${process.execPath} ${join(packageRoot(), 'bin', 'ccwt.mjs')} --plugin-path`
}

export function unusable(command: string): string | null {
  if (command.length > COMMAND_MAX) return `it is ${command.length} characters, over the ${COMMAND_MAX} allowed`
  if (!/^[\x20-\x7e]+$/.test(command)) return 'it is not all printable ASCII'
  if (/ {4}/.test(command)) return 'it contains a run of four or more spaces'
  return null
}

async function installed(): Promise<Installed | null> {
  const result = await claude(['plugin', 'list', '--json'])
  if (!result || result.code !== 0) return null

  try {
    const all = JSON.parse(result.stdout) as Installed[]
    return all.find((entry) => entry.id === ID) ?? null
  } catch {
    return null
  }
}

function stateOf(found: Installed | null): PluginState {
  if (!found) return 'absent'
  if (found.enabled === false) return 'disabled'
  return 'installed'
}

function issuesFor(state: PluginState, version: string | null): Diagnostic[] {
  if (state === 'unavailable') {
    return [
      {
        code: 'plugin.no-claude',
        severity: 'info',
        message: 'Claude Code is not on this machine’s PATH.',
        hint: 'ccwt drives `claude plugin` to install this. Install Claude Code, then reload.',
      },
    ]
  }

  if (tooOld(version)) {
    return [
      {
        code: 'plugin.claude-too-old',
        severity: 'warning',
        message: `Claude Code ${version} cannot install this plugin; it needs ${CLAUDE_MIN} or newer.`,
        hint: 'ccwt hands Claude Code a command that prints the plugin, so it can update itself without ccwt being asked. Older versions fail to read the marketplace at all, so nothing is written until Claude Code is updated.',
      },
    ]
  }

  if (state === 'disabled') {
    return [
      {
        code: 'plugin.disabled',
        severity: 'warning',
        message: 'The plugin is installed but switched off in Claude Code.',
        hint: 'Enable it here, or with `claude plugin enable ccwt@ccwt`.',
      },
    ]
  }

  const broken = unusable(pluginCommand())
  if (broken) {
    return [
      {
        code: 'plugin.command-unusable',
        severity: 'error',
        message: `Claude Code will not accept the command that prints this plugin — ${broken}.`,
        hint: `The command is built from where ccwt is installed: ${pluginCommand()}. Install ccwt somewhere Claude Code can name.`,
      },
    ]
  }

  return []
}

export async function report(extra: Diagnostic[] = []): Promise<PluginReport> {
  const shipped = await shippedVersion()
  const version = await claudeVersion()

  if (version === null) {
    return {
      state: 'unavailable',
      installed: null,
      shipped,
      scope: null,
      installedAt: null,
      source: sourceDir(),
      commands: commands(),
      capabilities: CAPABILITIES,
      parts: await parts(),
      issues: [...issuesFor('unavailable', version), ...extra],
    }
  }

  const found = await installed()
  const state = stateOf(found)
  const missing = state === 'absent' ? await missingSource() : []

  return {
    state,
    installed: found?.version ?? null,
    shipped,
    scope: found?.scope ?? null,
    installedAt: found?.installedAt ?? null,
    source: sourceDir(),
    commands: commands(),
    capabilities: CAPABILITIES,
    parts: await parts(),
    issues: [
      ...(missing.length ? [absent(missing)] : []),
      ...issuesFor(state, version),
      ...extra,
    ],
  }
}

export async function materialise(): Promise<void> {
  const root = packageRoot()
  const target = sourceDir()

  const template = await readJson<Marketplace>(join(root, '.claude-plugin', 'marketplace.json'))
  if (!template?.plugins?.length) throw new Error('ccwt ships no marketplace to install from.')

  const listed = template.plugins.map((entry) =>
    entry.name === NAME
      ? { ...entry, source: { source: 'command', command: pluginCommand() } }
      : entry,
  )

  await rm(target, { recursive: true, force: true })
  await mkdir(join(target, '.claude-plugin'), { recursive: true, mode: 0o700 })

  await writeFile(
    join(target, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ ...template, plugins: listed }, null, 2) + '\n',
    { mode: 0o600 },
  )
}

function failed(what: string, code: number, stderr: string): Diagnostic {
  const tail = stderr.trim().split('\n').slice(-3).join('\n')
  return {
    code: 'plugin.install-failed',
    severity: 'error',
    message: `\`${what}\` exited ${code}.`,
    hint: tail || 'Claude Code gave no reason. Run the command yourself to see what it says.',
  }
}

export async function install(): Promise<PluginReport> {
  const version = await claudeVersion()
  if (version === null || tooOld(version)) return report()

  const broken = unusable(pluginCommand())
  if (broken) return report()

  const missing = await missingSource()
  if (missing.length) return report([absent(missing)])

  await materialise()

  const added = await claude(['plugin', 'marketplace', 'add', sourceDir()], INSTALL_MS)
  if (added && added.code !== 0 && !/already/i.test(added.stderr)) {
    return report([failed('claude plugin marketplace add', added.code, added.stderr)])
  }

  await claude(['plugin', 'marketplace', 'update', NAME], INSTALL_MS)

  const put = await claude(['plugin', 'install', ID, '--scope', 'user', '-y'], INSTALL_MS)
  if (!put) {
    return report([failed('claude plugin install', -1, 'the command did not finish')])
  }
  if (put.code !== 0) {
    return report([failed('claude plugin install', put.code, put.stderr)])
  }

  const said = put.stdout.trim().split('\n').slice(-4).join('\n')

  return report([
    {
      code: 'plugin.installed',
      severity: 'info',
      message: said || 'Claude Code installed the plugin without saying anything.',
      hint: 'From here Claude Code keeps it current on its own: it runs ccwt once a session to find the plugin, and reloads when the files change. If it did not switch the plugin on, run `/reload-plugins --force` in a session you already have open.',
    },
  ])
}

export async function enable(): Promise<PluginReport> {
  if ((await claudeVersion()) === null) return report()

  const result = await claude(['plugin', 'enable', ID], INSTALL_MS)
  if (result && result.code !== 0) {
    return report([failed('claude plugin enable', result.code, result.stderr)])
  }

  return report()
}

export async function remove(): Promise<PluginReport> {
  if ((await claudeVersion()) === null) return report()

  const result = await claude(['plugin', 'uninstall', ID], INSTALL_MS)
  if (result && result.code !== 0 && !/not installed/i.test(result.stderr)) {
    return report([failed('claude plugin uninstall', result.code, result.stderr)])
  }

  await rm(sourceDir(), { recursive: true, force: true })
  return report()
}
