#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const TITLE_PREFIX = 'ccwt · '
const PROBE_MS = 400

const git = async (cwd, args) => {
  const { stdout } = await run('git', args, { cwd }).catch(() => ({ stdout: '' }))
  return stdout.trim()
}

const portKey = (service) =>
  `ccwt.port.${service.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`

function reaches(port, host) {
  return new Promise((done) => {
    const socket = connect({ port, host })
    const finish = (answer) => {
      socket.destroy()
      done(answer)
    }
    socket.setTimeout(PROBE_MS)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

const isListening = async (port) =>
  (await Promise.all([reaches(port, '127.0.0.1'), reaches(port, '::1')])).some(Boolean)

async function readState() {
  const raw = await readFile(join(homedir(), '.ccwt', 'state.json'), 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseWorktrees(porcelain) {
  const paths = []
  let bare = false
  let current = null

  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current && !bare) paths.push(current)
      current = line.slice('worktree '.length)
      bare = false
      continue
    }
    if (line === 'bare') bare = true
  }
  if (current && !bare) paths.push(current)

  return paths
}

async function allocatedPorts(worktreePath) {
  const raw = await git(worktreePath, ['config', '--worktree', '--get-regexp', '^ccwt\\.port\\.'])
  const found = new Map()

  for (const line of raw.split('\n')) {
    const gap = line.indexOf(' ')
    if (gap === -1) continue
    const port = Number.parseInt(line.slice(gap + 1), 10)
    if (Number.isFinite(port)) found.set(line.slice(0, gap), port)
  }

  return found
}

async function describe(cwd) {
  const toplevel = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (!toplevel) return null

  const porcelain = await git(cwd, ['worktree', 'list', '--porcelain'])
  const paths = parseWorktrees(porcelain)
  const rootPath = paths[0]
  if (!rootPath) return null

  const state = await readState()
  const project = (state?.projects ?? []).find(
    (entry) => resolve(entry.rootPath) === resolve(rootPath),
  )
  const declared = project?.config?.services ?? []
  if (!declared.length) return null

  const worktrees = await Promise.all(
    paths.map(async (path) => {
      const ports = await allocatedPorts(path)

      const services = await Promise.all(
        declared.map(async (service) => {
          const port = ports.get(portKey(service.name)) ?? null
          return {
            name: service.name,
            command: service.command,
            port,
            up: port === null ? false : await isListening(port),
          }
        }),
      )

      return {
        path,
        name: path.split('/').pop() ?? path,
        root: resolve(path) === resolve(rootPath),
        services,
      }
    }),
  )

  const here = worktrees.find((worktree) => resolve(worktree.path) === resolve(toplevel)) ?? null

  return { rootPath, projectName: rootPath.split('/').pop() ?? rootPath, worktrees, here }
}

const shapeOf = (command) =>
  command
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .split(/\s+/)
    .filter((part) => part && part !== '--' && !part.startsWith('-'))

function duplicates(proposed, declared) {
  const want = shapeOf(declared)
  const got = shapeOf(proposed)
  if (want.length < 2 || got.length < want.length) return false

  for (let start = 0; start <= got.length - want.length; start += 1) {
    if (want.every((part, index) => got[start + index] === part)) return true
  }

  return false
}

function targetOf(command, fallback) {
  const match = /^\s*cd\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(&&|;)/.exec(command)
  const path = match?.[2] ?? match?.[3] ?? match?.[4]
  if (!path) return fallback
  return path.startsWith('/') ? path : resolve(fallback, path)
}

function snapshot(found) {
  const rows = {}
  for (const worktree of found.worktrees) {
    for (const service of worktree.services) {
      if (service.port === null) continue
      rows[`${worktree.name}/${service.name}`] = { port: service.port, up: service.up }
    }
  }
  return rows
}

function changes(before, after) {
  const lines = []

  for (const [key, now] of Object.entries(after)) {
    const then = before[key]
    if (!then) {
      lines.push(`${key} → port ${now.port}${now.up ? `, running at http://localhost:${now.port}` : ', stopped'}`)
      continue
    }
    if (then.port !== now.port) {
      lines.push(`${key} moved to port ${now.port} (was ${then.port})${now.up ? ` and is running at http://localhost:${now.port}` : ' and is stopped'}`)
      continue
    }
    if (then.up !== now.up) {
      lines.push(now.up ? `${key} is now running at http://localhost:${now.port}` : `${key} has stopped`)
    }
  }

  for (const key of Object.keys(before)) {
    if (!after[key]) lines.push(`${key} is gone`)
  }

  return lines
}

const markerPath = (sessionId) =>
  join(homedir(), '.ccwt', 'sessions', `${sessionId.replace(/[^A-Za-z0-9_-]/g, '')}.json`)

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

async function writeMarker(sessionId, marker) {
  if (!sessionId) return
  await mkdir(join(homedir(), '.ccwt', 'sessions'), { recursive: true, mode: 0o700 }).catch(
    () => undefined,
  )
  await writeFile(markerPath(sessionId), JSON.stringify(marker), { mode: 0o600 }).catch(
    () => undefined,
  )
}

function titleFor(found) {
  if (!found.here || found.here.root) return null
  return `${TITLE_PREFIX}${found.projectName}/${found.here.name}`
}

const renameTo = (found, current) => {
  const wanted = titleFor(found)
  if (!wanted || wanted === current) return null
  return !current || current.startsWith(TITLE_PREFIX) ? wanted : null
}

function overview(found) {
  const rows = found.worktrees
    .filter((worktree) => worktree.services.some((service) => service.port !== null))
    .map((worktree) => {
      const services = worktree.services
        .filter((service) => service.port !== null)
        .map(
          (service) =>
            `${service.name} → ${service.port} ${service.up ? `running at http://localhost:${service.port}` : 'stopped'}`,
        )
        .join(', ')
      return `  ${worktree.name}${worktree.root ? ' (root)' : ''} — ${services}`
    })

  if (!rows.length) return null

  return [
    'ccwt manages this repository. It owns these services and the ports they run on:',
    ...rows,
    '',
    'Do not start a dev server yourself — open the URL above instead. Starting, stopping and',
    'restarting a service is ccwt’s job, from its dashboard. Call ccwt_logs to see what a running',
    'service has printed rather than building to find out.',
  ].join('\n')
}

const emit = (payload) => process.stdout.write(JSON.stringify(payload))

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
  const title = renameTo(found, input?.session_title)
  const payload = {}

  if (context) payload.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: context }
  if (title) payload.sessionTitle = title

  await writeMarker(input?.session_id, { at: new Date().toISOString(), rows: snapshot(found) })

  if (Object.keys(payload).length) emit(payload)
}

async function prompt(input, found) {
  const rows = snapshot(found)
  const marker = await readMarker(input?.session_id)
  const lines = marker ? changes(marker.rows ?? {}, rows) : []

  const title = renameTo(found, input?.session_title)
  const payload = {}

  if (!marker) {
    const context = overview(found)
    if (context) payload.hookSpecificOutput = { hookEventName: 'UserPromptSubmit', additionalContext: context }
  } else if (lines.length) {
    payload.hookSpecificOutput = {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `ccwt: ${lines.join('\nccwt: ')}`,
    }
  }

  if (title) payload.sessionTitle = title

  await writeMarker(input?.session_id, { at: new Date().toISOString(), rows })

  if (Object.keys(payload).length) emit(payload)
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

const found = await describe(input?.cwd ?? process.cwd()).catch(() => null)

if (found) {
  if (mode === 'session-start') await sessionStart(input, found)
  if (mode === 'prompt') await prompt(input, found)
  if (mode === 'guard') guard(input, found)
}

process.exit(0)
