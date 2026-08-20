import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { Address } from '../../shared/types'
import { configPath, stateDir } from './paths'

export const LOOPBACK: Address['host'][] = ['127.0.0.1', 'localhost', '::1']

export const DEFAULT_ADDRESS: Address = { host: '127.0.0.1', port: 4600 }

function coerce(held: unknown): Partial<Address> {
  if (typeof held !== 'object' || held === null) return {}

  const { host, port } = held as Record<string, unknown>

  return {
    ...(typeof host === 'string' && LOOPBACK.includes(host as Address['host'])
      ? { host: host as Address['host'] }
      : {}),
    ...(Number.isInteger(port) && (port as number) >= 1024 && (port as number) <= 65_535
      ? { port: port as number }
      : {}),
  }
}

export async function readAddress(): Promise<Address> {
  const raw = await readFile(configPath(), 'utf8').catch(() => null)
  if (raw === null) return { ...DEFAULT_ADDRESS }

  let held: unknown
  try {
    held = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_ADDRESS }
  }

  return { ...DEFAULT_ADDRESS, ...coerce(held) }
}

export async function writeAddress(wanted: { host: string; port: number }): Promise<Address> {
  if (!LOOPBACK.includes(wanted.host as Address['host'])) {
    throw new Error(
      `ccwt binds loopback only — ${LOOPBACK.join(', ')}. It runs git and spawns processes, so a reachable address would be remote code execution.`,
    )
  }

  if (!Number.isInteger(wanted.port) || wanted.port < 1024 || wanted.port > 65_535) {
    throw new Error('A port must be a whole number between 1024 and 65535.')
  }

  const next: Address = { host: wanted.host as Address['host'], port: wanted.port }

  await mkdir(stateDir(), { recursive: true, mode: 0o700 })
  await writeFile(configPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })

  return next
}
