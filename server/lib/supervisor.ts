import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { LogLine, ServiceConfig, ServiceState, ServiceStatus } from '../../shared/types'
import { argv } from './exec'

const MAX_LINES = 1000
const SETTLE_MS = 750
const KILL_AFTER_MS = 4000

export type LogListener = (line: LogLine) => void
export type StatusListener = (worktreeId: string, status: ServiceStatus) => void

interface Entry {
  worktreeId: string
  service: string
  port: number
  state: ServiceState
  pid: number | null
  startedAt: string
  exitCode: number | null
  child: ChildProcess | null
  stopping: boolean
  settle: NodeJS.Timeout | null
}

const entries = new Map<string, Entry>()
const logs = new Map<string, LogLine[]>()
const logListeners = new Set<LogListener>()
const statusListeners = new Set<StatusListener>()

const keyFor = (worktreeId: string, service: string) => `${worktreeId}:${service}`

export interface Vars {
  port: number
  slug: string
  branch: string
  rootPath: string
  worktreePath: string
}

export function render(template: string, vars: Vars): string {
  return template
    .replaceAll('{{port}}', String(vars.port))
    .replaceAll('{{slug}}', vars.slug)
    .replaceAll('{{branch}}', vars.branch)
    .replaceAll('{{rootPath}}', vars.rootPath)
    .replaceAll('{{worktreePath}}', vars.worktreePath)
    .replaceAll('{{url}}', `http://127.0.0.1:${vars.port}`)
}

function toStatus(entry: Entry): ServiceStatus {
  return {
    name: entry.service,
    state: entry.state,
    port: entry.port || null,
    url: entry.state === 'running' && entry.port ? `http://127.0.0.1:${entry.port}` : null,
    pid: entry.pid,
    startedAt: entry.startedAt,
    exitCode: entry.exitCode,
  }
}

function emitStatus(entry: Entry): void {
  const status = toStatus(entry)
  for (const listener of statusListeners) listener(entry.worktreeId, status)
}

export function note(
  worktreeId: string,
  service: string,
  text: string,
  stream: 'stdout' | 'stderr' = 'stdout',
): void {
  const key = keyFor(worktreeId, service)
  const line: LogLine = {
    worktreeId,
    service,
    stream,
    at: new Date().toISOString(),
    text,
  }

  const buffer = logs.get(key) ?? []
  buffer.push(line)
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES)
  logs.set(key, buffer)

  for (const listener of logListeners) listener(line)
}

function push(entry: Entry, stream: 'stdout' | 'stderr', text: string): void {
  note(entry.worktreeId, entry.service, text, stream)
}

function pipe(entry: Entry, stream: NodeJS.ReadableStream | null, kind: 'stdout' | 'stderr'): void {
  if (!stream) return
  stream.setEncoding('utf8')

  let carry = ''
  stream.on('data', (chunk: string) => {
    const parts = (carry + chunk).split('\n')
    carry = parts.pop() ?? ''
    for (const part of parts) push(entry, kind, part.replace(/\r$/, ''))
  })
  stream.on('end', () => {
    if (carry) {
      push(entry, kind, carry)
      carry = ''
    }
  })
}

export function status(worktreeId: string, service: string): ServiceStatus | null {
  const entry = entries.get(keyFor(worktreeId, service))
  return entry ? toStatus(entry) : null
}

export function scrollback(worktreeId: string, service: string): LogLine[] {
  return logs.get(keyFor(worktreeId, service)) ?? []
}

export function scrollbackFor(worktreeId: string): LogLine[] {
  const out: LogLine[] = []
  for (const [key, buffer] of logs) {
    if (key.startsWith(`${worktreeId}:`)) out.push(...buffer)
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

export function subscribe(listener: LogListener): () => void {
  logListeners.add(listener)
  return () => logListeners.delete(listener)
}

export function subscribeStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export async function start(
  worktreeId: string,
  worktreePath: string,
  service: ServiceConfig,
  port: number,
  vars: Vars,
): Promise<ServiceStatus> {
  const key = keyFor(worktreeId, service.name)
  const existing = entries.get(key)

  if (existing && (existing.state === 'running' || existing.state === 'starting')) {
    return toStatus(existing)
  }

  const parts = argv(render(service.command, vars))
  const head = parts[0]
  if (!head) throw new Error(`Service \`${service.name}\` has no command`)

  const entry: Entry = {
    worktreeId,
    service: service.name,
    port,
    state: 'starting',
    pid: null,
    startedAt: new Date().toISOString(),
    exitCode: null,
    child: null,
    stopping: false,
    settle: null,
  }

  entries.set(key, entry)

  const child = spawn(head, parts.slice(1), {
    cwd: resolve(worktreePath, service.cwd || '.'),
    env: { ...process.env, PORT: String(port), FORCE_COLOR: '0', BROWSER: 'none' },
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  entry.child = child
  entry.pid = child.pid ?? null

  pipe(entry, child.stdout, 'stdout')
  pipe(entry, child.stderr, 'stderr')

  child.on('error', (cause) => {
    entry.state = 'crashed'
    entry.exitCode = -1
    entry.child = null
    push(entry, 'stderr', cause.message)
    emitStatus(entry)
  })

  child.on('exit', (code, signal) => {
    if (entry.settle) clearTimeout(entry.settle)
    entry.settle = null
    entry.child = null
    entry.pid = null
    entry.exitCode = code
    entry.state = entry.stopping || code === 0 || signal === 'SIGTERM' ? 'stopped' : 'crashed'
    entry.stopping = false
    emitStatus(entry)
  })

  entry.settle = setTimeout(() => {
    entry.settle = null
    if (entry.state !== 'starting') return
    entry.state = 'running'
    emitStatus(entry)
  }, SETTLE_MS)

  emitStatus(entry)
  return toStatus(entry)
}

function signal(entry: Entry, sig: NodeJS.Signals): void {
  const child = entry.child
  if (!child?.pid) return

  if (process.platform === 'win32') {
    child.kill(sig)
    return
  }

  try {
    process.kill(-child.pid, sig)
  } catch {
    try {
      child.kill(sig)
    } catch {
      return
    }
  }
}

export async function stop(worktreeId: string, service: string): Promise<ServiceStatus> {
  const key = keyFor(worktreeId, service)
  const entry = entries.get(key)

  if (!entry) {
    return {
      name: service,
      state: 'stopped',
      port: null,
      url: null,
      pid: null,
      startedAt: null,
      exitCode: null,
    }
  }

  if (!entry.child) {
    entry.state = 'stopped'
    return toStatus(entry)
  }

  entry.stopping = true
  const child = entry.child

  await new Promise<void>((done) => {
    const timer = setTimeout(() => {
      signal(entry, 'SIGKILL')
    }, KILL_AFTER_MS)

    child.once('exit', () => {
      clearTimeout(timer)
      done()
    })

    signal(entry, 'SIGTERM')
  })

  return toStatus(entry)
}

export async function stopWorktree(worktreeId: string): Promise<void> {
  const names: string[] = []
  for (const [key, entry] of entries) {
    if (key.startsWith(`${worktreeId}:`)) names.push(entry.service)
  }
  await Promise.all(names.map((name) => stop(worktreeId, name)))
  for (const name of names) {
    entries.delete(keyFor(worktreeId, name))
    logs.delete(keyFor(worktreeId, name))
  }
}

export async function stopAll(): Promise<void> {
  const all = [...entries.values()].map((entry) => stop(entry.worktreeId, entry.service))
  await Promise.all(all)
  entries.clear()
}
