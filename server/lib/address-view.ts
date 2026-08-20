import { readFile } from 'node:fs/promises'
import type { Address, AddressView, LoopbackHost } from '../../shared/types'
import { LOOPBACK, readAddress } from './address'
import { runtimePath } from './paths'

async function live(): Promise<Address | null> {
  const raw = await readFile(runtimePath(), 'utf8').catch(() => null)
  if (raw === null) return null

  let held: unknown
  try {
    held = JSON.parse(raw)
  } catch {
    return null
  }

  const { host, port } = (held ?? {}) as Record<string, unknown>
  if (!Number.isInteger(port)) return null

  return {
    host: LOOPBACK.includes(host as LoopbackHost) ? (host as LoopbackHost) : '127.0.0.1',
    port: port as number,
  }
}

export async function describeAddress(): Promise<AddressView> {
  const [saved, running] = await Promise.all([readAddress(), live()])

  return {
    saved,
    live: running,
    pending: running !== null && (running.host !== saved.host || running.port !== saved.port),
  }
}
