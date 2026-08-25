import { basename } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { Occupancy, Occupant } from '../../shared/types'
import { exec } from './exec'
import { isInside } from './git'

const LOOK_MS = 8_000

async function actual(path: string): Promise<string> {
  return realpath(path).catch(() => path)
}

async function ancestry(): Promise<Set<number>> {
  const mine = new Set<number>([process.pid])
  let current = process.ppid

  for (let step = 0; step < 12 && current > 1; step += 1) {
    mine.add(current)

    const found = await exec('ps', ['-o', 'ppid=', '-p', String(current)], {
      timeoutMs: LOOK_MS,
    }).catch(() => null)

    const next = Number.parseInt(found?.stdout.trim() ?? '', 10)
    if (!Number.isFinite(next) || next <= 1) break
    current = next
  }

  return mine
}

interface Standing {
  pid: number
  cwd: string
}

function parse(out: string): Standing[] {
  const standing: Standing[] = []
  let pid = 0

  for (const line of out.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number.parseInt(line.slice(1), 10)
      continue
    }
    if (!line.startsWith('n') || !Number.isFinite(pid) || pid <= 1) continue

    const cwd = line.slice(1)
    if (cwd) standing.push({ pid, cwd })
  }

  return standing
}

async function describe(
  pid: number,
  cwd: string,
  managed: Set<number>,
): Promise<Occupant | null> {
  const found = await exec('ps', ['-o', 'user=,pgid=,command=', '-p', String(pid)], {
    timeoutMs: LOOK_MS,
  }).catch(() => null)

  const line = found?.stdout.split('\n').find((row) => row.trim()) ?? ''
  const parts = /^(\S+)\s+(\d+)\s+(.*)$/.exec(line.trim())
  const command = parts?.[3]?.trim() ?? ''

  if (!command) return null

  const group = Number.parseInt(parts?.[2] ?? '', 10)

  return {
    pid,
    name: basename(command.split(' ')[0] ?? '') || 'unknown',
    command,
    cwd,
    user: parts?.[1] ?? null,
    ours: managed.has(pid) || (Number.isFinite(group) && managed.has(group)),
  }
}

export async function occupants(worktreePath: string, managed: number[] = []): Promise<Occupancy> {
  if (process.platform === 'win32') {
    return {
      occupants: [],
      why: 'ccwt cannot see what is working inside a directory on Windows.',
    }
  }

  const found = await exec('lsof', ['-d', 'cwd', '-Fpn'], { timeoutMs: LOOK_MS }).catch(() => null)

  if (!found) {
    return {
      occupants: [],
      why: 'ccwt could not run `lsof`, so it cannot see what is working inside this worktree.',
    }
  }

  const root = await actual(worktreePath)
  const mine = await ancestry()
  const ours = new Set(managed)

  const inside: Standing[] = []
  const seen = new Set<number>()

  for (const one of parse(found.stdout)) {
    if (mine.has(one.pid) || seen.has(one.pid)) continue
    if (!isInside(root, await actual(one.cwd))) continue

    seen.add(one.pid)
    inside.push(one)
  }

  const described = (await Promise.all(inside.map((one) => describe(one.pid, one.cwd, ours))))
    .filter((one): one is Occupant => one !== null)
    .sort((a, b) => Number(a.ours) - Number(b.ours))

  return { occupants: described, why: null }
}
