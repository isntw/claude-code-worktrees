import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { resolve } from 'node:path'
import type {
  LogLine,
  ServiceConfig,
  ServiceState,
  ServiceStatus,
} from '../../shared/types'
import { argv, exec } from './exec'
import { envKey } from './envfile'

const MAX_LINES = 1000
const KILL_AFTER_MS = 4000
const PROBE_EVERY_MS = 300
const PROBE_FOR_MS = 25_000

const LOOPBACK = ['127.0.0.1', '::1']

function connectTo(port: number, host: string): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host })
    const finish = (answer: boolean) => {
      socket.destroy()
      done(answer)
    }
    socket.setTimeout(1000)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function canConnect(port: number): Promise<boolean> {
  const attempts = await Promise.all(LOOPBACK.map((host) => connectTo(port, host)))
  return attempts.some(Boolean)
}

export type LogListener = (line: LogLine) => void
export type StatusListener = (worktreeId: string, status: ServiceStatus) => void

interface Entry {
  worktreeId: string
  service: string
  port: number
  cwd: string
  stopCommand: string | null
  declared: Record<string, number>
  state: ServiceState
  pid: number | null
  startedAt: string
  exitCode: number | null
  reachable: boolean | null
  child: ChildProcess | null
  stopping: boolean
  probing: boolean
}

const entries = new Map<string, Entry>()
const logs = new Map<string, LogLine[]>()
const logListeners = new Set<LogListener>()
const statusListeners = new Set<StatusListener>()

const keyFor = (worktreeId: string, service: string) => `${worktreeId}:${service}`

export interface Vars {
  project: string
  port: number
  ports: Record<string, number>
  declared?: Record<string, number>
  slug: string
  branch: string
  rootPath: string
  worktreePath: string
}

const urlFor = (port: number) => `http://localhost:${port}`

export function render(template: string, vars: Vars): string {
  return template
    .replace(/\{\{port\.([A-Za-z0-9_-]+)\}\}/g, (whole, name: string) => {
      const port = vars.ports[name]
      if (port === undefined) throw new Error(`${whole} names a service this project does not have`)
      return String(port)
    })
    .replace(/\{\{url\.([A-Za-z0-9_-]+)\}\}/g, (whole, name: string) => {
      const port = vars.ports[name]
      if (port === undefined) throw new Error(`${whole} names a service this project does not have`)
      return urlFor(port)
    })
    .replaceAll('{{port}}', String(vars.port))
    .replaceAll('{{project}}', vars.project)
    .replaceAll('{{slug}}', vars.slug)
    .replaceAll('{{branch}}', vars.branch)
    .replaceAll('{{rootPath}}', vars.rootPath)
    .replaceAll('{{worktreePath}}', vars.worktreePath)
    .replaceAll('{{url}}', urlFor(vars.port))
}

function toStatus(entry: Entry): ServiceStatus {
  return {
    name: entry.service,
    state: entry.state,
    port: entry.port || null,
    url: entry.reachable && entry.port ? urlFor(entry.port) : null,
    pid: entry.pid,
    startedAt: entry.startedAt,
    exitCode: entry.exitCode,
    reachable: entry.reachable,
    allocated: Object.keys(entry.declared).length ? entry.declared : undefined,
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

export function waitReachable(
  worktreeId: string,
  service: string,
  timeoutMs = PROBE_FOR_MS,
): Promise<boolean> {
  const entry = entries.get(keyFor(worktreeId, service))
  if (!entry) return Promise.resolve(false)

  return new Promise((done) => {
    const deadline = Date.now() + timeoutMs

    const tick = () => {
      if (entry.reachable === true) return done(true)
      if (!entry.child || Date.now() > deadline) return done(false)
      setTimeout(tick, 200)
    }

    tick()
  })
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
    cwd: resolve(worktreePath, service.cwd || '.'),
    stopCommand: service.stopCommand ? render(service.stopCommand, vars) : null,
    declared: vars.declared ?? {},
    state: 'starting',
    pid: null,
    startedAt: new Date().toISOString(),
    exitCode: null,
    reachable: null,
    child: null,
    stopping: false,
    probing: false,
  }

  entries.set(key, entry)

  const declared: Record<string, string> = {}

  for (const [name, allocated] of Object.entries(vars.ports)) {
    declared[envKey('CCWT_PORT', name)] = String(allocated)
    declared[envKey('CCWT_URL', name)] = urlFor(allocated)
  }

  for (const [name, allocated] of Object.entries(vars.declared ?? {})) {
    declared[name] = String(allocated)
  }

  for (const [key, value] of Object.entries(service.env ?? {})) {
    declared[key] = render(value, vars)
  }

  const child = spawn(head, parts.slice(1), {
    cwd: resolve(worktreePath, service.cwd || '.'),
    env: {
      ...process.env,
      PORT: String(port),
      FORCE_COLOR: '0',
      BROWSER: 'none',
      ...declared,
    },
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
    entry.probing = false
    entry.child = null
    entry.pid = null
    entry.exitCode = code
    entry.reachable = null
    entry.state = entry.stopping || code === 0 || signal === 'SIGTERM' ? 'stopped' : 'crashed'
    entry.stopping = false
    emitStatus(entry)
  })

  void probe(entry)

  emitStatus(entry)
  return toStatus(entry)
}

async function probe(entry: Entry): Promise<void> {
  entry.probing = true
  const deadline = Date.now() + PROBE_FOR_MS

  while (entry.probing && entry.child) {
    if (await canConnect(entry.port)) {
      if (!entry.probing) return
      entry.reachable = true
      entry.state = 'running'
      emitStatus(entry)
      return
    }

    if (Date.now() > deadline) break
    await new Promise((wait) => setTimeout(wait, PROBE_EVERY_MS))
  }

  if (!entry.probing || !entry.child) return

  entry.reachable = false
  entry.state = 'running'
  note(
    entry.worktreeId,
    entry.service,
    `nothing is listening on port ${entry.port} — this command does not appear to take the port ccwt assigned it`,
    'stderr',
  )
  emitStatus(entry)
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
      reachable: null,
      pid: null,
      startedAt: null,
      exitCode: null,
    }
  }

  if (!entry.child) {
    entry.state = 'stopped'
    await runStopCommand(entry)
    return toStatus(entry)
  }

  entry.stopping = true
  entry.probing = false
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

  await runStopCommand(entry)
  return toStatus(entry)
}

async function runStopCommand(entry: Entry): Promise<void> {
  if (!entry.stopCommand) return

  const parts = argv(entry.stopCommand)
  const head = parts[0]
  if (!head) return

  note(entry.worktreeId, entry.service, `stopping: ${entry.stopCommand}`)
  const result = await exec(head, parts.slice(1), { cwd: entry.cwd, timeoutMs: 120_000 }).catch(
    () => null,
  )

  if (result && result.code !== 0) {
    note(entry.worktreeId, entry.service, result.stderr.trim().split('\n').slice(-3).join('\n'), 'stderr')
  }
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
