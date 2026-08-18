#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ccwtDir, describe, duplicates, targetOf } from '../lib/discover.mjs'
import { changes, overview, renameTo, snapshot } from '../lib/report.mjs'

const markerPath = (sessionId) =>
  join(ccwtDir(), 'sessions', `${sessionId.replace(/[^A-Za-z0-9_-]/g, '')}.json`)

async function readMarker(sessionId) {
  if (!sessionId) return null
  const raw = await readFile(markerPath(sessionId), 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeMarker(sessionId, rows, title) {
  if (!sessionId) return
  await mkdir(join(ccwtDir(), 'sessions'), { recursive: true, mode: 0o700 }).catch(() => undefined)
  await writeFile(
    markerPath(sessionId),
    JSON.stringify({ at: new Date().toISOString(), rows, title }),
    { mode: 0o600 },
  ).catch(() => undefined)
}

const emit = (payload) => {
  if (Object.keys(payload).length) process.stdout.write(JSON.stringify(payload))
}

const read = () =>
  new Promise((done) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      text += chunk
    })
    process.stdin.on('end', () => {
      try {
        done(JSON.parse(text))
      } catch {
        done(null)
      }
    })
    process.stdin.on('error', () => done(null))
  })

async function sessionStart(input, found) {
  const context = overview(found)
  const marker = await readMarker(input?.session_id)
  const title = renameTo(found, input?.session_title, marker?.title)
  const payload = {}

  if (context) {
    payload.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: context }
  }
  if (title) payload.sessionTitle = title

  await writeMarker(input?.session_id, snapshot(found), title ?? marker?.title)
  emit(payload)
}

async function prompt(input, found) {
  const rows = snapshot(found)
  const marker = await readMarker(input?.session_id)
  const title = renameTo(found, input?.session_title, marker?.title)
  const payload = {}

  if (!marker) {
    const context = overview(found)
    if (context) {
      payload.hookSpecificOutput = { hookEventName: 'UserPromptSubmit', additionalContext: context }
    }
  } else {
    const lines = changes(marker.rows ?? {}, rows)
    if (lines.length) {
      payload.hookSpecificOutput = {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `ccwt: ${lines.join('\nccwt: ')}`,
      }
    }
  }

  if (title) payload.sessionTitle = title

  await writeMarker(input?.session_id, rows, title ?? marker?.title)
  emit(payload)
}

function guard(input, found) {
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
      permissionDecisionReason: `ccwt already runs \`${clash.name}\` for ${worktree.name}, listening on http://localhost:${clash.port}. Open that rather than starting a second one — ccwt owns this service's lifecycle. Call ccwt_logs to read what it has printed.`,
    },
  })
}

const [, , mode] = process.argv
const input = await read()

if (mode === 'end') {
  const sessionId = input?.session_id
  if (sessionId) await rm(markerPath(sessionId), { force: true }).catch(() => undefined)
  process.exit(0)
}

const found = await describe(input?.cwd ?? process.cwd(), input?.transcript_path).catch(
  () => null,
)

if (found) {
  if (mode === 'session-start') await sessionStart(input, found)
  if (mode === 'prompt') await prompt(input, found)
  if (mode === 'guard') guard(input, found)
}

process.exit(0)
