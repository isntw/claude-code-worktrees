import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { clearWorktreeConfig, readWorktreeConfig, writeWorktreeConfig } from './git'

const KEY = (service: string) => `ccwt.port.${service}`

export function hashToRange(seed: string, range: [number, number]): number {
  const [low, high] = range
  const span = Math.max(1, high - low + 1)
  const digest = createHash('sha256').update(seed).digest()
  return low + (digest.readUInt32BE(0) % span)
}

export function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

export async function readAllocated(
  worktreePath: string,
  service: string,
): Promise<number | null> {
  const raw = await readWorktreeConfig(worktreePath, KEY(service))
  if (!raw) return null
  const port = Number.parseInt(raw, 10)
  return Number.isFinite(port) ? port : null
}

export async function allocate(
  worktreePath: string,
  service: string,
  range: [number, number],
): Promise<number> {
  const existing = await readAllocated(worktreePath, service)
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

  throw new Error(`No free port in ${low}-${high} for ${service}`)
}

export async function release(worktreePath: string, service: string): Promise<void> {
  await clearWorktreeConfig(worktreePath, KEY(service))
}
