import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { git, locate, parseWorktrees, reachServer, readState } from '../plugin/src/lib/discover.ts'
import type { Told } from '../plugin/src/mcp/answer.ts'
import { within } from '../plugin/src/mcp/reach.ts'
import { tool } from '../plugin/src/mcp/tools.ts'

export const USAGE = `
  Worktrees  (these talk to the ccwt that is running: \`ccwt start\` first)
    ccwt ls [path]                     every worktree, its services, ports and what is up;
                                       every project when run outside one
    ccwt up [worktree] [-s service] [--take-over]
                                       start the services of a worktree; --take-over
                                       stops a sibling holding a pinned port first
    ccwt down [worktree] [-s service]  stop them; the worktree is kept
    ccwt logs [worktree] [-s service] [-n lines] [--offset n]
                                       what a service printed
    ccwt open [worktree] [-s service]  open a running service in the browser
    ccwt path <worktree|-p project>    print a worktree's path: cd "$(ccwt path name)"
    ccwt repair [worktree] [--refresh] put back the files the recipe names

    They work from any directory. A worktree defaults to the one the current
    directory is in; a named one is looked up in every registered project.
    -p, --project <name>  pick the project, from anywhere, when a name is ambiguous
    --json                print the structured answer instead of text
`

const SAID: Record<string, string> = {
  ccwt_get_status: 'ccwt ls',
  ccwt_start_worktree: 'ccwt up',
  ccwt_stop_worktree: 'ccwt down',
  ccwt_get_logs: 'ccwt logs',
  ccwt_provision_worktree: 'ccwt repair',
}

const TOOL_FOR: Record<string, string> = {
  ls: 'ccwt_get_status',
  path: 'ccwt_get_status',
  open: 'ccwt_get_status',
  up: 'ccwt_start_worktree',
  down: 'ccwt_stop_worktree',
  logs: 'ccwt_get_logs',
  repair: 'ccwt_provision_worktree',
}

interface Service {
  name: string
  primary?: boolean
  port: number | null
  up: boolean
  heldBy?: string
  url: string | null
}

interface Worktree {
  name: string
  path: string
  root: boolean
  services: Service[]
}

interface Status {
  ok: boolean
  message?: string
  project?: { name: string; rootPath: string }
  worktrees?: Worktree[]
}

const tilde = (path: string) => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path)

export const here = (worktrees: Worktree[], cwd: string): Worktree | null =>
  worktrees
    .filter((entry) => within(entry.path, cwd))
    .sort((a, b) => resolve(b.path).length - resolve(a.path).length)[0] ?? null

export function inputFor(
  command: string,
  worktree: string | undefined,
  values: Record<string, unknown>,
  path: string | undefined,
) {
  const service = values.service as string | undefined
  if (command === 'ls' || command === 'path' || command === 'open') return { path }
  if (command === 'logs') {
    const number = (value: unknown) => (value === undefined ? undefined : Number(value))
    return { worktree, service, limit: number(values.lines), offset: number(values.offset), path }
  }
  if (command === 'repair') return { worktree, refresh: values.refresh === true ? true : undefined, path }
  if (command === 'up') return { worktree, service, takeOver: values['take-over'] === true ? true : undefined, path }
  return { worktree, service, path }
}

interface Registered {
  name: string
  rootPath: string
}

const worktreesOf = async (rootPath: string) => parseWorktrees(await git(rootPath, ['worktree', 'list', '--porcelain']))

export function matching(found: { project: Registered; paths: string[] }[], worktree: string): { project: Registered; path: string }[] {
  return found.flatMap(({ project, paths }) =>
    paths.filter((path) => basename(path) === worktree).map((path) => ({ project, path })),
  )
}

async function aim(
  projects: Registered[],
  project: string | undefined,
  worktree: string | undefined,
  cwd: string,
): Promise<string | null | { error: string }> {
  if (project) {
    const found = projects.find((entry) => entry.name === project)
    if (found) return found.rootPath
    return { error: `No registered project is called ${project}. ccwt has: ${projects.map((entry) => entry.name).join(', ') || 'none'}.` }
  }

  const local = (await locate(cwd))?.project ?? null
  if (!worktree) return local ? cwd : null
  if (local && (await worktreesOf(local.rootPath)).some((path) => basename(path) === worktree)) return cwd

  const found = await Promise.all(projects.map(async (entry) => ({ project: entry, paths: await worktreesOf(entry.rootPath) })))
  const matches = matching(found, worktree)
  if (matches.length === 1) return matches[0]!.path
  if (!matches.length) return { error: `No registered project has a worktree called ${worktree}. \`ccwt ls\` lists them.` }
  return {
    error: `${worktree} is a worktree in more than one project: ${matches.map((entry) => entry.project.name).join(', ')}. Pick one with -p.`,
  }
}

const plain = (text: string) =>
  text
    .replace(/ccwt_[a-z_]+/g, (name) => SAID[name] ?? name)
    .replace(/`offset: (\d+)`/g, '`--offset $1`')
    .replace(/`service: "([^"]+)"`/g, '`-s $1`')
    .replace(/\btakeOver\b/g, '--take-over')

function listing(status: Status, cwd: string): string {
  const worktrees = status.worktrees ?? []
  const current = here(worktrees, cwd)
  const width = Math.max(...worktrees.map((entry) => entry.name.length + (entry.root ? 7 : 0)))
  const lines = [`${status.project!.name}  ${tilde(status.project!.rootPath)}`, '']

  for (const worktree of worktrees) {
    const name = `${worktree.name}${worktree.root ? ' (root)' : ''}`
    lines.push(`${worktree === current ? '*' : ' '} ${name.padEnd(width)}  ${tilde(worktree.path)}`)
    const serviceWidth = Math.max(...worktree.services.map((service) => service.name.length))
    for (const service of worktree.services) {
      const port = service.port === null ? 'no port' : `:${service.port}`
      const state = service.up
        ? `up  ${service.url}`
        : `stopped${service.heldBy ? ` (port held by ${service.heldBy})` : ''}`
      lines.push(`    ${service.name.padEnd(serviceWidth)}  ${port.padEnd(6)}  ${state}`)
    }
  }

  return lines.join('\n')
}

function chosen(status: Status, name: string | undefined, at: string): Worktree | string {
  const worktrees = status.worktrees ?? []
  const found = name ? worktrees.find((entry) => entry.name === name) : here(worktrees, at)
  if (found) return found
  return [
    name ? `This repository has no worktree called ${name}. It has:` : "This directory is not in one of ccwt's worktrees. Name one of:",
    ...worktrees.map((entry) => `  ${entry.name}  ${tilde(entry.path)}`),
  ].join('\n')
}

function opened(worktree: Worktree, wanted: string | undefined): string | null {
  const service = wanted
    ? worktree.services.find((entry) => entry.name === wanted)
    : (worktree.services.find((entry) => entry.primary) ?? worktree.services[0])
  if (!service) {
    return wanted
      ? `${worktree.name} has no service called ${wanted}. It has: ${worktree.services.map((entry) => entry.name).join(', ') || 'none'}.`
      : `${worktree.name} has no services.`
  }
  if (!service.up || !service.url) return `${service.name} in ${worktree.name} is not running. Start it with \`ccwt up ${worktree.name}\`.`
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawn(opener, [service.url], { stdio: 'ignore', detached: true }).unref()
  return null
}

export async function run(argv: string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        service: { type: 'string', short: 's' },
        lines: { type: 'string', short: 'n' },
        offset: { type: 'string' },
        project: { type: 'string', short: 'p' },
        refresh: { type: 'boolean' },
        'take-over': { type: 'boolean' },
        json: { type: 'boolean' },
      },
      allowPositionals: true,
    })
  } catch (cause) {
    process.stderr.write(`${(cause as Error).message}\n${USAGE}\n`)
    return 1
  }

  const { values, positionals } = parsed
  const [command, worktree, ...extra] = positionals
  if (!command || !TOOL_FOR[command] || extra.length) {
    process.stderr.write(`Unknown command: ${positionals.join(' ')}\n${USAGE}\n`)
    return 1
  }
  if (command === 'path' && !worktree && !values.project) {
    process.stderr.write('ccwt path needs a worktree name or -p. `ccwt ls` lists them.\n')
    return 1
  }

  if (!(await reachServer())) {
    process.stderr.write('ccwt is not running, so there is nothing to ask. Start it with `ccwt start`.\n')
    return 1
  }

  const projects: Registered[] = ((await readState())?.projects ?? []).map((entry) => ({
    name: basename(entry.rootPath),
    rootPath: entry.rootPath,
  }))
  const cwd = process.cwd()
  const aimed = command === 'ls' && worktree ? resolve(worktree) : await aim(projects, values.project, worktree, cwd)
  if (aimed !== null && typeof aimed === 'object') {
    process.stderr.write(`${aimed.error}\n`)
    return 1
  }
  if (aimed === null && command === 'ls') return everything(projects, values.json === true, cwd)
  if (aimed === null) {
    process.stderr.write('This directory is not inside a project ccwt manages. Name a worktree, or pick a project with -p.\n')
    return 1
  }

  const { inputSchema, handler } = tool(TOOL_FOR[command])
  const input = inputSchema.safeParse(inputFor(command, worktree, values, aimed))
  if (!input.success) {
    process.stderr.write(`${input.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')}\n`)
    return 1
  }

  const answer: Told = await handler(input.data as Record<string, unknown>)
  const data = answer.structuredContent as unknown as Status
  const failed = answer.isError === true || data.ok === false

  const text = plain(answer.content[0]?.text ?? '')
  const json = `${JSON.stringify(answer.structuredContent, null, 2)}\n`

  if (failed) {
    if (values.json) process.stdout.write(json)
    else process.stderr.write(`${text}\n`)
    return 1
  }

  if (command !== 'path' && command !== 'open') {
    process.stdout.write(values.json ? json : `${command === 'ls' ? listing(data, cwd) : text}\n`)
    return 0
  }

  const picked = chosen(data, worktree, aimed)
  if (typeof picked === 'string') {
    process.stderr.write(`${picked}\n`)
    return 1
  }

  if (command === 'path') {
    process.stdout.write(values.json ? `${JSON.stringify(picked, null, 2)}\n` : `${picked.path}\n`)
    return 0
  }

  const problem = opened(picked, values.service)
  if (problem) {
    process.stderr.write(`${problem}\n`)
    return 1
  }
  return 0
}

async function everything(projects: Registered[], json: boolean, cwd: string): Promise<number> {
  if (!projects.length) {
    process.stdout.write('No projects are registered with ccwt yet.\n')
    return 0
  }

  const { handler } = tool('ccwt_get_status')
  const statuses = await Promise.all(
    projects.map(async (project) => ({
      project,
      status: (await handler({ path: project.rootPath })).structuredContent as unknown as Status,
    })),
  )

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, projects: statuses.map(({ status }) => status) }, null, 2)}\n`)
    return 0
  }

  const blocks = statuses.map(({ project, status }) =>
    status.ok ? listing(status, cwd) : `${project.name}  ${tilde(project.rootPath)}\n\n  nothing to run: its recipe declares no services`,
  )
  process.stdout.write(`${blocks.join('\n\n')}\n`)
  return 0
}
