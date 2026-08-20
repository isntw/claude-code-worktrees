import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const PROBE_MS = 400

export const ccwtDir = () => process.env.CCWT_HOME || join(homedir(), '.ccwt')

const CALL_MS = 3_000

export const PLACE_MS = 300_000

export const git = async (cwd, args) => {
  const { stdout } = await run('git', args, { cwd }).catch(() => ({ stdout: '' }))
  return stdout.trim()
}

export const portKey = (service) =>
  `ccwt.port.${service.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`

export const idFor = (path) => createHash('sha256').update(path).digest('hex').slice(0, 12)

export const encodedName = (path) => path.replace(/[/._]/g, '-')

export function underTranscript(paths, transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null

  const parts = transcriptPath.split('/')
  const named = parts[parts.length - 2]
  if (!named) return null

  return paths.find((path) => encodedName(path) === named) ?? null
}

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

export const isListening = async (port) =>
  (await Promise.all([reaches(port, '127.0.0.1'), reaches(port, '::1')])).some(Boolean)

async function readJson(path) {
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function reachServer() {
  const runtime = await readJson(join(ccwtDir(), 'runtime.json'))
  if (!runtime?.port || typeof runtime.token !== 'string') return null

  const host = runtime.host === '::1' ? '[::1]' : (runtime.host ?? '127.0.0.1')
  if (!(await isListening(runtime.port))) return null

  return { origin: `http://${host}:${runtime.port}`, token: runtime.token }
}

export async function ask(path) {
  const server = await reachServer()
  if (!server) return null

  const answered = await fetch(`${server.origin}${path}`, {
    headers: { 'x-ccwt-token': server.token },
    signal: AbortSignal.timeout(CALL_MS),
  }).catch(() => null)

  if (!answered?.ok) return null
  return answered.json().catch(() => null)
}

export async function tell(path, body) {
  const server = await reachServer()
  if (!server) return null

  const answered = await fetch(`${server.origin}${path}`, {
    method: 'PUT',
    headers: { 'x-ccwt-token': server.token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_MS),
  }).catch(() => null)

  return answered?.ok ? true : null
}

export async function call(method, path, body, timeoutMs = CALL_MS) {
  const server = await reachServer()
  if (!server) return { server: false, ok: false, status: 0, timedOut: false, body: null }

  const answered = await fetch(`${server.origin}${path}`, {
    method,
    headers: {
      'x-ccwt-token': server.token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((cause) => cause)

  if (!(answered instanceof Response)) {
    const timedOut = answered?.name === 'TimeoutError' || answered?.name === 'AbortError'
    return { server: true, ok: false, status: 0, timedOut, body: null }
  }

  const payload = await answered.json().catch(() => null)
  return { server: true, ok: answered.ok, status: answered.status, timedOut: false, body: payload }
}

export const readState = () => ask('/api/plugin/state')

export async function locate(cwd) {
  const toplevel = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (!toplevel) return null

  const paths = parseWorktrees(await git(cwd, ['worktree', 'list', '--porcelain']))
  const rootPath = paths[0] ?? toplevel

  const state = await readState()
  if (!state) return { rootPath, here: toplevel, project: null, reachable: false }

  const project = (state.projects ?? []).find(
    (entry) => resolve(entry.rootPath) === resolve(rootPath),
  )

  return { rootPath, here: toplevel, project: project ?? null, reachable: true }
}

export function parseWorktrees(porcelain) {
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

export async function describe(cwd, transcriptPath) {
  const toplevel = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (!toplevel) return null

  const paths = parseWorktrees(await git(cwd, ['worktree', 'list', '--porcelain']))
  const rootPath = paths[0]
  if (!rootPath) return null

  const state = await readState()
  const project = (state?.projects ?? []).find(
    (entry) => resolve(entry.rootPath) === resolve(rootPath),
  )
  const declared = project?.config?.services ?? []
  if (!project || !declared.length) return null

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
        id: idFor(path),
        path,
        name: path.split('/').pop() ?? path,
        root: resolve(path) === resolve(rootPath),
        services,
      }
    }),
  )

  const at = (path) =>
    path ? (worktrees.find((worktree) => resolve(worktree.path) === resolve(path)) ?? null) : null

  const walked = at(toplevel)
  const launched = at(underTranscript(worktrees.map((worktree) => worktree.path), transcriptPath))

  const here = (walked && !walked.root ? walked : null) ?? launched ?? walked ?? null

  return {
    projectId: project.id,
    projectName: rootPath.split('/').pop() ?? rootPath,
    rootPath,
    worktrees,
    here,
  }
}

export const shapeOf = (command) =>
  command
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .split(/\s+/)
    .filter((part) => part && part !== '--' && !part.startsWith('-'))

const WRAPPERS = new Set(['nohup', 'env', 'exec', 'time', 'command', 'sudo'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function heads(command) {
  return command
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ')
    .split(/&&|\|\||;|\|/)
    .map((segment) => {
      const parts = shapeOf(segment)
      let start = 0
      while (start < parts.length) {
        const part = parts[start]
        if (part !== undefined && (ASSIGNMENT.test(part) || WRAPPERS.has(part))) {
          start += 1
          continue
        }
        break
      }
      return parts.slice(start)
    })
}

export function duplicates(proposed, declared) {
  const want = shapeOf(declared)
  if (want.length < 2) return false

  return heads(proposed).some(
    (got) => got.length >= want.length && want.every((part, index) => got[index] === part),
  )
}

export function targetOf(command, fallback) {
  const match = /^\s*cd\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(&&|;)/.exec(command)
  const path = match?.[2] ?? match?.[3] ?? match?.[4]
  if (!path) return fallback
  return path.startsWith('/') ? path : resolve(fallback, path)
}
