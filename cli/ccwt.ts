import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { Told } from '../plugin/src/mcp/answer.ts'
import { within } from '../plugin/src/mcp/reach.ts'
import { tool } from '../plugin/src/mcp/tools.ts'

export const USAGE = `
  Worktrees  (the dashboard must be running, except for ls, path and open)
    ccwt ls [path]                     every worktree, its services, ports and what is up
    ccwt up [worktree] [-s service]    start the services of a worktree
    ccwt down [worktree] [-s service]  stop them; the worktree is kept
    ccwt logs [worktree] [-s service] [-n lines] [--offset n]
                                       what a service printed
    ccwt open [worktree] [-s service]  open a running service in the browser
    ccwt path <worktree>               print a worktree's path: cd "$(ccwt path name)"
    ccwt repair [worktree] [--refresh] put back the files the recipe names

    A worktree defaults to the one the current directory is in.
    --json prints the structured answer instead of text.
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

export function inputFor(command: string, worktree: string | undefined, values: Record<string, unknown>) {
  const service = values.service as string | undefined
  if (command === 'ls') return { path: worktree }
  if (command === 'path' || command === 'open') return {}
  if (command === 'logs') {
    const number = (value: unknown) => (value === undefined ? undefined : Number(value))
    return { worktree, service, limit: number(values.lines), offset: number(values.offset) }
  }
  if (command === 'repair') return { worktree, refresh: values.refresh === true ? true : undefined }
  return { worktree, service }
}

const plain = (text: string) =>
  text
    .replace(/ccwt_[a-z_]+/g, (name) => SAID[name] ?? name)
    .replace(/`offset: (\d+)`/g, '`--offset $1`')
    .replace(/`service: "([^"]+)"`/g, '`-s $1`')

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

function chosen(status: Status, name: string | undefined, cwd: string): Worktree | string {
  const worktrees = status.worktrees ?? []
  const found = name ? worktrees.find((entry) => entry.name === name) : here(worktrees, cwd)
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
        refresh: { type: 'boolean' },
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
  if (command === 'path' && !worktree) {
    process.stderr.write('ccwt path needs the name of a worktree. `ccwt ls` lists them.\n')
    return 1
  }

  const { inputSchema, handler } = tool(TOOL_FOR[command])
  const input = inputSchema.safeParse(inputFor(command, worktree, values))
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
    process.stdout.write(values.json ? json : `${command === 'ls' ? listing(data, resolve(worktree ?? '.')) : text}\n`)
    return 0
  }

  const picked = chosen(data, worktree, process.cwd())
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
