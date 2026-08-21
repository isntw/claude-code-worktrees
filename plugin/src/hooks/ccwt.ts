import { resolve } from 'node:path'
import { ask, describe, duplicates, targetOf, tell } from '../lib/discover.ts'
import type { Seen } from '../lib/discover.ts'
import { changes, overview, payloadFor, renameTo, snapshot } from '../lib/report.ts'
import type { HookPayload, Rows } from '../lib/report.ts'

interface Marker {
  at: string
  rows?: Rows
  title?: string
}

interface HookInput {
  session_id?: string
  session_title?: string
  transcript_path?: string
  cwd?: string
  tool_input?: { command?: string }
}

const markerId = (sessionId: string) => encodeURIComponent(sessionId.replace(/[^A-Za-z0-9_-]/g, ''))

async function readMarker(sessionId: string | undefined): Promise<Marker | null> {
  if (!sessionId) return null
  const held = await ask<Marker>(`/api/plugin/session/${markerId(sessionId)}`)
  return held && typeof held.at === 'string' ? held : null
}

async function writeMarker(
  sessionId: string | undefined,
  rows: Rows,
  title: string | undefined,
): Promise<void> {
  if (!sessionId) return
  await tell(`/api/plugin/session/${markerId(sessionId)}`, { rows, title })
}

async function dropMarker(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return
  await tell(`/api/plugin/session/${markerId(sessionId)}`, { done: true })
}

const emit = (payload: HookPayload | Record<string, unknown>): void => {
  if (Object.keys(payload).length) process.stdout.write(JSON.stringify(payload))
}

const read = (): Promise<HookInput | null> =>
  new Promise((done) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      text += chunk
    })
    process.stdin.on('end', () => {
      try {
        done(JSON.parse(text) as HookInput)
      } catch {
        done(null)
      }
    })
    process.stdin.on('error', () => done(null))
  })

const noticed = (lines: string[]): string | null =>
  lines.length ? `ccwt: ${lines.join('\nccwt: ')}` : null

async function sessionStart(input: HookInput | null, found: Seen): Promise<void> {
  const marker = await readMarker(input?.session_id)
  const title = renameTo(found, input?.session_title, marker?.title)

  await writeMarker(input?.session_id, snapshot(found), title ?? marker?.title)
  emit(payloadFor('SessionStart', overview(found), title))
}

async function prompt(input: HookInput | null, found: Seen): Promise<void> {
  const rows = snapshot(found)
  const marker = await readMarker(input?.session_id)
  const title = renameTo(found, input?.session_title, marker?.title)
  const context = marker ? noticed(changes(marker.rows ?? {}, rows)) : overview(found)

  await writeMarker(input?.session_id, rows, title ?? marker?.title)
  emit(payloadFor('UserPromptSubmit', context, title))
}

function guard(input: HookInput | null, found: Seen): void {
  const command = input?.tool_input?.command
  if (typeof command !== 'string' || !command) return

  const target = targetOf(command, input?.cwd ?? process.cwd())
  const worktree =
    found.worktrees.find((entry) => resolve(target) === resolve(entry.path)) ?? found.here
  if (!worktree) return

  const clash = worktree.services.find(
    (service) => service.up && service.port !== null && duplicates(command, service.command),
  )
  if (!clash) return

  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `ccwt already runs \`${clash.name}\` for ${worktree.name}, listening on http://localhost:${clash.port}. Open that rather than starting a second one — ccwt owns this service's lifecycle. Call ccwt_get_logs to read what it has printed.`,
    },
  })
}

const mode = process.argv[2]
const input = await read()

if (mode === 'end') {
  await dropMarker(input?.session_id)
  process.exit(0)
}

const found = await describe(input?.cwd ?? process.cwd(), input?.transcript_path).catch(() => null)

if (found) {
  if (mode === 'session-start') await sessionStart(input, found)
  if (mode === 'prompt') await prompt(input, found)
  if (mode === 'guard') guard(input, found)
}

process.exit(0)
