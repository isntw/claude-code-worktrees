import { realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type {
  ForeignHolder,
  FreeOutcome,
  FreeRequest,
  PortHolders,
  ServiceHolder,
} from '../../shared/types'
import { projectName } from './projects'
import { exec } from './exec'
import { isInside } from './git'
import { isListening } from './ports'
import * as supervisor from './supervisor'

const LOOK_MS = 5_000
const PROBE_MS = 300
const QUIET_EVERY_MS = 200
const QUIET_FOR_MS = 4_000
const HARD_FOR_MS = 2_000

async function ourHolders(port: number): Promise<ServiceHolder[]> {
  return Promise.all(
    supervisor.holding(port).map(async (held) => ({
      worktreeId: held.worktreeId,
      worktree:
        resolve(held.worktreePath) === resolve(held.rootPath)
          ? 'root'
          : basename(held.worktreePath),
      project: await projectName(held.rootPath),
      service: held.service,
      state: held.state,
      pid: held.pid,
      startedAt: held.startedAt,
    })),
  )
}

interface Listening {
  pids: number[]
  why: string | null
}

async function listeningPids(port: number): Promise<Listening> {
  if (process.platform === 'win32') {
    return { pids: [], why: 'ccwt cannot see which process holds a port on Windows.' }
  }

  const found = await exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {
    timeoutMs: LOOK_MS,
  }).catch(() => null)

  if (!found) {
    return {
      pids: [],
      why: 'ccwt could not run `lsof`, so it cannot see which process holds this port.',
    }
  }

  const pids = new Set<number>()
  for (const line of found.stdout.split('\n')) {
    if (!line.startsWith('p')) continue
    const pid = Number.parseInt(line.slice(1), 10)
    if (Number.isFinite(pid) && pid > 1) pids.add(pid)
  }

  if (pids.size === 0 && found.code !== 0 && found.stderr.trim()) {
    return { pids: [], why: found.stderr.trim().split('\n')[0] ?? null }
  }

  return { pids: [...pids], why: null }
}

async function workingDir(pid: number): Promise<string | null> {
  const found = await exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    timeoutMs: LOOK_MS,
  }).catch(() => null)

  if (!found) return null

  for (const line of found.stdout.split('\n')) {
    if (line.startsWith('n')) return line.slice(1) || null
  }

  return null
}

async function describe(pid: number): Promise<ForeignHolder> {
  const found = await exec('ps', ['-o', 'user=,command=', '-p', String(pid)], {
    timeoutMs: LOOK_MS,
  }).catch(() => null)

  const line = found?.stdout.split('\n').find((row) => row.trim()) ?? ''
  const parts = /^(\S+)\s+(.*)$/.exec(line.trim())
  const command = parts?.[2]?.trim() ?? ''

  return {
    pid,
    name: basename(command.split(' ')[0] ?? '') || 'unknown',
    command,
    cwd: await workingDir(pid),
    user: parts?.[1] ?? null,
  }
}

export async function holders(port: number): Promise<PortHolders> {
  if (!(await isListening(port, PROBE_MS))) {
    return { port, free: true, ours: [], foreign: [], why: null }
  }

  const ours = await ourHolders(port)
  if (ours.length) return { port, free: false, ours, foreign: [], why: null }

  const { pids, why } = await listeningPids(port)
  const foreign = await Promise.all(pids.map(describe))

  return {
    port,
    free: false,
    ours: [],
    foreign,
    why: foreign.length
      ? null
      : (why ??
        `Something is answering on port ${port}, but ccwt cannot see what — it may belong to another user.`),
  }
}

async function stillHeld(port: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs

  while (Date.now() < deadline) {
    if (!(await isListening(port, PROBE_MS))) return false
    await new Promise((wait) => setTimeout(wait, QUIET_EVERY_MS))
  }

  return isListening(port, PROBE_MS)
}

async function ourPids(): Promise<Set<number>> {
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

function signal(pid: number, sig: NodeJS.Signals): string | null {
  try {
    process.kill(pid, sig)
    return null
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return 'That process is already gone.'
    if (code === 'EPERM') return 'That process belongs to someone else, so ccwt cannot stop it.'
    return (cause as Error).message
  }
}

function whyHeld(after: PortHolders): string {
  const ours = after.ours[0]
  if (ours) return `Port ${after.port} is still held by ${ours.service} in ${ours.worktree}.`

  const foreign = after.foreign[0]
  if (foreign) return `Port ${after.port} is still held by pid ${foreign.pid} (${foreign.name}).`

  return after.why ?? `Something is still answering on port ${after.port}.`
}

export async function free(port: number, request: FreeRequest): Promise<FreeOutcome> {
  const before = await holders(port)

  if (before.free) {
    return { port, freed: true, stopped: [], signalled: [], refused: [], why: null }
  }

  const stopped: string[] = []
  const signalled: number[] = []
  const refused: { pid: number; why: string }[] = []

  for (const wanted of request.services) {
    const held = before.ours.find(
      (holder) => holder.worktreeId === wanted.worktreeId && holder.service === wanted.service,
    )
    if (!held) continue

    await supervisor.stop(wanted.worktreeId, wanted.service)
    stopped.push(`${held.service} in ${held.worktree}`)
  }

  if (request.pids.length) {
    const mine = await ourPids()

    for (const pid of request.pids) {
      if (!before.foreign.some((holder) => holder.pid === pid)) {
        refused.push({ pid, why: `Nothing on port ${port} has that pid any more.` })
        continue
      }

      if (mine.has(pid)) {
        refused.push({ pid, why: 'That is ccwt itself, or the process that launched it.' })
        continue
      }

      const failed = signal(pid, 'SIGTERM')
      if (failed === null) signalled.push(pid)
      else refused.push({ pid, why: failed })
    }
  }

  if (stopped.length || signalled.length) {
    if (await stillHeld(port, QUIET_FOR_MS)) {
      for (const pid of signalled) signal(pid, 'SIGKILL')
      await stillHeld(port, HARD_FOR_MS)
    }
  }

  const after = await holders(port)

  return {
    port,
    freed: after.free,
    stopped,
    signalled,
    refused,
    why: after.free ? null : whyHeld(after),
  }
}

async function actual(path: string): Promise<string> {
  return realpath(path).catch(() => path)
}

export async function reapWithin(port: number, worktreePath: string): Promise<ForeignHolder[]> {
  const before = await holders(port)
  if (before.free || !before.foreign.length) return []

  const root = await actual(worktreePath)
  const mine = await ourPids()
  const strays: ForeignHolder[] = []

  for (const holder of before.foreign) {
    if (holder.cwd === null || mine.has(holder.pid)) continue
    if (isInside(root, await actual(holder.cwd))) strays.push(holder)
  }

  if (!strays.length) return []

  for (const stray of strays) signal(stray.pid, 'SIGTERM')

  if (await stillHeld(port, QUIET_FOR_MS)) {
    for (const stray of strays) signal(stray.pid, 'SIGKILL')
    await stillHeld(port, HARD_FOR_MS)
  }

  return strays
}
