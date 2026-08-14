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

function freeOn(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    try {
      probe.listen({ port, host, ipv6Only: host === '::1' })
    } catch {
      resolve(false)
    }
  })
}

export async function isFree(port: number): Promise<boolean> {
  for (const host of LOOPBACK) {
    if (!(await freeOn(port, host))) return false
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

export async function allocate(
  worktreePath: string,
  service: string,
  range: [number, number],
): Promise<number> {
  const existing = await readAllocated(worktreePath, service, range)
  if (existing !== null) return existing

  const [low, high] = range
  const span = Math.max(1, high - low + 1)
  const start = hashToRange(`${worktreePath}:${service}`, range)

  for (let step = 0; step < span; step += 1) {
    const port = low + ((start - low + step) % span)
    if (await isFree(port)) {
      await writeWorktreeConfig(worktreePath, KEY(service), String(port))
      return port
    }
  }

  if (low === high) {
    throw new Error(
      `\`${service}\` is pinned to port ${low} and something is already listening there, so only one worktree can run it at a time.`,
    )
  }

  throw new Error(`No free port in ${low}-${high} for ${service}`)
}

export async function release(worktreePath: string, service: string): Promise<void> {
  await clearWorktreeConfig(worktreePath, KEY(service))
}
