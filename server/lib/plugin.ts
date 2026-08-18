import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Diagnostic, PluginCapability, PluginReport, PluginState } from '../../shared/types'
import { exec } from './exec'

const ID = 'ccwt@ccwt'
const PROBE_MS = 20_000
const INSTALL_MS = 120_000

interface Installed {
  id: string
  version?: string
  scope?: string
  enabled?: boolean
  installedAt?: string
}

export const sourceDir = (): string => join(homedir(), '.ccwt', 'plugin')

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
      'Two read-only tools, so a change can be checked against what the running service printed rather than by starting another one. Nothing can start, stop or restart a service.',
  },
]

export function commands(): string[] {
  return [
    `claude plugin marketplace add ${sourceDir()}`,
    `claude plugin install ${ID} --scope user -y`,
  ]
}

async function shippedVersion(): Promise<string> {
  const raw = await readFile(
    join(packageRoot(), 'plugin', '.claude-plugin', 'plugin.json'),
    'utf8',
  ).catch(() => null)
  if (raw === null) return '0.0.0'

  try {
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

async function claude(args: string[], timeoutMs = PROBE_MS) {
  return exec('claude', args, { timeoutMs }).catch(() => null)
}

async function present(): Promise<boolean> {
  const result = await claude(['--version'])
  return result !== null && result.code === 0
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

function stateOf(found: Installed | null, shipped: string): PluginState {
  if (!found) return 'absent'
  if (found.enabled === false) return 'disabled'
  return found.version === shipped ? 'installed' : 'outdated'
}

function issuesFor(state: PluginState, shipped: string, found: Installed | null): Diagnostic[] {
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

  if (state === 'outdated') {
    return [
      {
        code: 'plugin.outdated',
        severity: 'warning',
        message: `The installed plugin is ${found?.version ?? 'an older version'}; this ccwt ships ${shipped}.`,
        hint: 'Update it here. Nothing is installed or changed until you do.',
      },
    ]
  }

  return []
}

export async function report(extra: Diagnostic[] = []): Promise<PluginReport> {
  const shipped = await shippedVersion()

  if (!(await present())) {
    return {
      state: 'unavailable',
      installed: null,
      shipped,
      scope: null,
      installedAt: null,
      source: sourceDir(),
      commands: commands(),
      capabilities: CAPABILITIES,
      issues: [...issuesFor('unavailable', shipped, null), ...extra],
    }
  }

  const found = await installed()
  const state = stateOf(found, shipped)

  return {
    state,
    installed: found?.version ?? null,
    shipped,
    scope: found?.scope ?? null,
    installedAt: found?.installedAt ?? null,
    source: sourceDir(),
    commands: commands(),
    capabilities: CAPABILITIES,
    issues: [...issuesFor(state, shipped, found), ...extra],
  }
}

async function materialise(): Promise<void> {
  const root = packageRoot()
  const target = sourceDir()

  await rm(target, { recursive: true, force: true })
  await mkdir(join(target, '.claude-plugin'), { recursive: true, mode: 0o700 })

  await cp(join(root, 'plugin'), join(target, 'plugin'), { recursive: true })
  await cp(
    join(root, '.claude-plugin', 'marketplace.json'),
    join(target, '.claude-plugin', 'marketplace.json'),
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
  if (!(await present())) return report()

  await materialise()

  const added = await claude(['plugin', 'marketplace', 'add', sourceDir()], INSTALL_MS)
  if (added && added.code !== 0 && !/already/i.test(added.stderr)) {
    return report([failed('claude plugin marketplace add', added.code, added.stderr)])
  }

  await claude(['plugin', 'marketplace', 'update', 'ccwt'], INSTALL_MS)

  const put = await claude(['plugin', 'install', ID, '--scope', 'user', '-y'], INSTALL_MS)
  if (!put) {
    return report([failed('claude plugin install', -1, 'the command did not finish')])
  }
  if (put.code !== 0) {
    return report([failed('claude plugin install', put.code, put.stderr)])
  }

  return report()
}

export async function enable(): Promise<PluginReport> {
  if (!(await present())) return report()

  const result = await claude(['plugin', 'enable', ID], INSTALL_MS)
  if (result && result.code !== 0) {
    return report([failed('claude plugin enable', result.code, result.stderr)])
  }

  return report()
}

export async function remove(): Promise<PluginReport> {
  if (!(await present())) return report()

  const result = await claude(['plugin', 'uninstall', ID], INSTALL_MS)
  if (result && result.code !== 0 && !/not installed/i.test(result.stderr)) {
    return report([failed('claude plugin uninstall', result.code, result.stderr)])
  }

  await rm(sourceDir(), { recursive: true, force: true })
  return report()
}
