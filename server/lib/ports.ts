import { createHash } from 'node:crypto'
import { connect, createServer } from 'node:net'
import {
  clearLocalConfig,
  clearWorktreeConfig,
  localKeys,
  readWorktreeConfig,
  writeWorktreeConfig,
} from './git'

const PREFIX = 'ccwt.port.'

const KEY = (service: string) =>
  `${PREFIX}${service.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`

const swept = new Set<string>()

export async function pruneSharedPorts(rootPath: string): Promise<void> {
  if (swept.has(rootPath)) return
  swept.add(rootPath)

  for (const key of await localKeys(rootPath, '^ccwt\\.port\\.')) {
    await clearLocalConfig(rootPath, key).catch(() => undefined)
  }
}

export function hashToRange(seed: string, range: [number, number]): number {
  const [low, high] = range
  const span = Math.max(1, high - low + 1)
  const digest = createHash('sha256').update(seed).digest()
  return low + (digest.readUInt32BE(0) % span)
}

const LOOPBACK = ['127.0.0.1', '::1']

interface Bind {
  host: string
  ipv6Only: boolean
}

const BINDS: Bind[] = [
  { host: '127.0.0.1', ipv6Only: false },
  { host: '::1', ipv6Only: true },
  { host: '0.0.0.0', ipv6Only: false },
  { host: '::', ipv6Only: true },
]

function freeOn(port: number, bind: Bind): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    try {
      probe.listen({ port, host: bind.host, ipv6Only: bind.ipv6Only })
    } catch {
      resolve(false)
    }
  })
}

export async function isFree(port: number): Promise<boolean> {
  for (const bind of BINDS) {
    if (!(await freeOn(port, bind))) return false
  }
  return true
}

export function withinRange(port: number, [low, high]: [number, number]): boolean {
  return port >= low && port <= high
}

function connectTo(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host })
    const finish = (answer: boolean) => {
      socket.destroy()
      done(answer)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function isListening(port: number, timeoutMs = 1000): Promise<boolean> {
  const attempts = await Promise.all(LOOPBACK.map((host) => connectTo(port, host, timeoutMs)))
  return attempts.some(Boolean)
}

export async function readAllocated(
  worktreePath: string,
  service: string,
  range?: [number, number],
): Promise<number | null> {
  const raw = await readWorktreeConfig(worktreePath, KEY(service))
  if (!raw) return null

  const port = Number.parseInt(raw, 10)
  if (!Number.isFinite(port)) return null

  return range && !withinRange(port, range) ? null : port
}

export interface Claim {
  keep?: boolean
  reserved?: Set<number>
}

export interface Allocated {
  port: number
  from: number | null
}

const pinned = (service: string, port: number) =>
  new Error(
    `\`${service}\` is pinned to port ${port} and something is already listening there, so only one worktree can run it at a time.`,
  )

async function usable(port: number, reserved: Set<number>): Promise<boolean> {
  if (reserved.has(port)) return false
  return isFree(port)
}

export async function allocate(
  worktreePath: string,
  service: string,
  range: [number, number],
  claim: Claim = {},
): Promise<Allocated> {
  const reserved = claim.reserved ?? new Set<number>()
  const [low, high] = range

  const existing = await readAllocated(worktreePath, service, range)

  if (existing !== null) {
    if (claim.keep) return { port: existing, from: null }
    if (await usable(existing, reserved)) return { port: existing, from: null }
    if (low === high) throw pinned(service, low)
  }

  const span = Math.max(1, high - low + 1)
  const start = hashToRange(`${worktreePath}:${service}`, range)

  for (let step = 0; step < span; step += 1) {
    const port = low + ((start - low + step) % span)
    if (await usable(port, reserved)) {
      await writeWorktreeConfig(worktreePath, KEY(service), String(port))
      return { port, from: existing }
    }
  }

  if (low === high) throw pinned(service, low)

  throw new Error(`No free port in ${low}-${high} for ${service}`)
}

export async function release(worktreePath: string, service: string): Promise<void> {
  await clearWorktreeConfig(worktreePath, KEY(service))
}
