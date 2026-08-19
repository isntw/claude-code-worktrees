import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import type { LogLine } from '../../shared/types'
import { fileKey, logsDir } from './paths'

const MAX_BYTES = 2_000_000
const MAX_TEXT = 8_192
const TRUNCATED = ' …[truncated]'

interface Sink {
  fd: number
  path: string
  size: number
}

const sinks = new Map<string, Sink>()

function quietly(work: () => void): boolean {
  try {
    work()
    return true
  } catch {
    return false
  }
}

const dirFor = (worktreeId: string) => join(logsDir(), fileKey(worktreeId))

const pathFor = (worktreeId: string, service: string) =>
  join(dirFor(worktreeId), `${fileKey(service)}.log`)

function clamp(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}${TRUNCATED}` : text
}

function openSink(worktreeId: string, service: string): Sink | null {
  const key = `${worktreeId}:${service}`
  const held = sinks.get(key)
  if (held) return held

  const path = pathFor(worktreeId, service)

  try {
    mkdirSync(dirFor(worktreeId), { recursive: true, mode: 0o700 })
    const size = existsSync(path) ? statSync(path).size : 0
    const sink: Sink = { fd: openSync(path, 'a'), path, size }
    sinks.set(key, sink)
    return sink
  } catch {
    return null
  }
}

function rotate(key: string, sink: Sink): void {
  quietly(() => closeSync(sink.fd))

  if (!quietly(() => renameSync(sink.path, `${sink.path}.1`))) {
    quietly(() => rmSync(sink.path, { force: true }))
  }

  sinks.delete(key)
}

export function append(line: LogLine): void {
  const key = `${line.worktreeId}:${line.service}`
  const sink = openSink(line.worktreeId, line.service)
  if (!sink) return

  const payload = `${JSON.stringify({ at: line.at, stream: line.stream, text: clamp(line.text) })}\n`

  try {
    sink.size += writeSync(sink.fd, payload)
  } catch {
    sinks.delete(key)
    return
  }

  if (sink.size >= MAX_BYTES) rotate(key, sink)
}

function parse(worktreeId: string, service: string, raw: string): LogLine[] {
  const out: LogLine[] = []

  for (const row of raw.split('\n')) {
    if (!row) continue
    try {
      const held = JSON.parse(row) as { at?: string; stream?: string; text?: string }
      if (typeof held.at !== 'string' || typeof held.text !== 'string') continue
      out.push({
        worktreeId,
        service,
        stream: held.stream === 'stderr' ? 'stderr' : 'stdout',
        at: held.at,
        text: held.text,
      })
    } catch {
      continue
    }
  }

  return out
}

function readOne(worktreeId: string, service: string, path: string): LogLine[] {
  const rolled = `${path}.1`
  const parts: string[] = []

  for (const candidate of [rolled, path]) {
    try {
      parts.push(readFileSync(candidate, 'utf8'))
    } catch {
      continue
    }
  }

  return parse(worktreeId, service, parts.join(''))
}

export function tail(worktreeId: string, service: string, limit: number): LogLine[] {
  const lines = readOne(worktreeId, service, pathFor(worktreeId, service))
  return limit > 0 && lines.length > limit ? lines.slice(-limit) : lines
}

export function tailAll(worktreeId: string, limit: number): LogLine[] {
  let names: string[]
  try {
    names = readdirSync(dirFor(worktreeId))
  } catch {
    return []
  }

  const out: LogLine[] = []

  for (const name of names) {
    if (!name.endsWith('.log')) continue
    const service = name.slice(0, -'.log'.length)
    out.push(...readOne(worktreeId, service, join(dirFor(worktreeId), name)))
  }

  out.sort((a, b) => a.at.localeCompare(b.at))
  return limit > 0 && out.length > limit ? out.slice(-limit) : out
}

export function closeService(worktreeId: string, service: string): void {
  const key = `${worktreeId}:${service}`
  const sink = sinks.get(key)
  if (!sink) return

  quietly(() => closeSync(sink.fd))
  sinks.delete(key)
}

export function forget(worktreeId: string): void {
  for (const key of [...sinks.keys()]) {
    if (key.startsWith(`${worktreeId}:`)) closeService(worktreeId, key.slice(worktreeId.length + 1))
  }

  quietly(() => rmSync(dirFor(worktreeId), { recursive: true, force: true }))
}

export function forgetService(worktreeId: string, service: string): void {
  closeService(worktreeId, service)
  const path = pathFor(worktreeId, service)

  for (const candidate of [path, `${path}.1`]) {
    quietly(() => rmSync(candidate, { force: true }))
  }
}
