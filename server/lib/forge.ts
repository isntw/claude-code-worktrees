import type {
  Diagnostic,
  ForgeStatus,
  MergeMethod,
  MergeOutcome,
  Mergeability,
  MergeState,
  PullRequest,
  PullState,
} from '../../shared/types'
import { gitOut } from './exec'
import { credential, configured } from './forgeauth'

const FRESH_MS = 60_000
const CALL_MS = 10_000
const LIMIT = 100
const API = 'https://api.github.com'

const SETTLE_TRIES = 5
const SETTLE_MS = 1_200

interface RawPull {
  number: number
  title: string
  html_url: string
  state: string
  draft: boolean
  merged_at: string | null
  head: { ref: string; sha: string }
  base: { ref: string }
}

interface RawDetail extends RawPull {
  merged: boolean
  mergeable: boolean | null
  mergeable_state: string
}

interface Entry {
  status: ForgeStatus
  filled: number
  etag: string | null
}

const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<ForgeStatus>>()

type StatusListener = (projectId: string, status: ForgeStatus) => void

const listeners = new Set<StatusListener>()

export function subscribe(listener: StatusListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function fingerprint(status: ForgeStatus): string {
  const pulls = Object.entries(status.pulls)
    .map(([ref, pull]) => `${ref} ${pull.number} ${pull.state} ${pull.headSha} ${pull.baseRef} ${pull.title}`)
    .sort()
  const issues = status.issues.map((issue) => `${issue.code} ${issue.message}`).sort()

  return JSON.stringify({ pulls, issues })
}

function stateOf(raw: RawPull): PullState {
  if (raw.merged_at) return 'merged'
  if (raw.state === 'closed') return 'closed'
  return raw.draft ? 'draft' : 'open'
}

function quiet(): ForgeStatus {
  return { at: new Date().toISOString(), pulls: {}, issues: [] }
}

function noted(issue: Diagnostic): ForgeStatus {
  return { at: new Date().toISOString(), pulls: {}, issues: [issue] }
}

export interface Repo {
  owner: string
  name: string
}

const REMOTE = /github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/i

export async function repoOf(rootPath: string): Promise<Repo | null> {
  const branch = await gitOut(rootPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const named = branch
    ? await gitOut(rootPath, ['config', '--get', `branch.${branch}.remote`])
    : null

  const url =
    (await gitOut(rootPath, ['remote', 'get-url', named ?? 'origin'])) ??
    (await gitOut(rootPath, ['remote', 'get-url', 'origin']))

  if (!url) return null

  const found = REMOTE.exec(url.trim())
  if (!found) return null

  const owner = found[1]
  const name = found[2]
  if (!owner || !name) return null

  return { owner, name }
}

interface Answer {
  ok: boolean
  status: number
  body: unknown
  etag: string | null
  said: string
}

async function callApi(
  path: string,
  token: string,
  init: { method?: string; body?: unknown; etag?: string | null } = {},
): Promise<Answer> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  }
  if (init.etag) headers['if-none-match'] = init.etag
  if (init.body !== undefined) headers['content-type'] = 'application/json'

  const answered = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(CALL_MS),
  }).catch((cause: Error) => {
    throw new Error(`GitHub could not be reached: ${cause.message}`)
  })

  const text = await answered.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  const message = (body as { message?: string } | null)?.message

  return {
    ok: answered.ok,
    status: answered.status,
    body,
    etag: answered.headers.get('etag'),
    said: message ?? `GitHub answered ${answered.status}`,
  }
}

function remaining(status: number, said: string): string {
  if (status === 401) return 'That sign-in is no longer valid. Sign in to GitHub again in Settings.'
  if (status === 403 && /rate limit/i.test(said)) {
    return 'GitHub is rate limiting this account. It clears on its own.'
  }
  if (status === 403 || status === 404) {
    return 'That account cannot see this repository. Sign in as one that can, or grant it access.'
  }
  return said
}

function unreachable(status: number, said: string, login: string | null): ForgeStatus {
  return noted({
    code: 'forge.unreachable',
    severity: 'info',
    message: 'Pull request status is unavailable, so cards show local git only.',
    hint: login ? `Signed in as ${login}. ${remaining(status, said)}` : remaining(status, said),
  })
}

function signedOut(): ForgeStatus {
  return noted({
    code: 'forge.signed-out',
    severity: 'info',
    message: 'Pull request status is unavailable, so cards show local git only.',
    hint: configured()
      ? 'Sign in to GitHub in Settings to see pull requests and merge from here.'
      : 'No GitHub client id is set, so ccwt cannot offer a sign-in. Start ccwt with CCWT_GITHUB_CLIENT_ID set to an OAuth app that has device flow enabled.',
  })
}

interface Fetched {
  status: ForgeStatus
  etag: string | null
}

async function read(projectId: string, rootPath: string): Promise<Fetched> {
  const repo = await repoOf(rootPath)
  if (!repo) return { status: quiet(), etag: null }

  const held = await credential()
  if (!held) return { status: signedOut(), etag: null }

  const previous = cache.get(projectId)

  const answered = await callApi(
    `/repos/${repo.owner}/${repo.name}/pulls?state=all&per_page=${LIMIT}&sort=updated&direction=desc`,
    held.token,
    { etag: previous?.etag ?? null },
  )

  if (answered.status === 304 && previous) {
    return {
      status: { ...previous.status, at: new Date().toISOString() },
      etag: previous.etag,
    }
  }

  if (!answered.ok) {
    return { status: unreachable(answered.status, answered.said, held.login), etag: null }
  }

  const raw = Array.isArray(answered.body) ? (answered.body as RawPull[]) : []

  const pulls: Record<string, PullRequest> = {}
  for (const entry of raw) {
    const ref = entry.head?.ref
    if (!ref || pulls[ref]) continue
    pulls[ref] = {
      number: entry.number,
      title: entry.title,
      url: entry.html_url,
      state: stateOf(entry),
      baseRef: entry.base?.ref ?? '',
      headSha: entry.head?.sha ?? '',
    }
  }

  const issues: Diagnostic[] =
    raw.length < LIMIT
      ? []
      : [
          {
            code: 'forge.truncated',
            severity: 'warning',
            message: `Only the ${LIMIT} most recently updated pull requests were read, so an older one may be missing from a card.`,
          },
        ]

  return { status: { at: new Date().toISOString(), pulls, issues }, etag: answered.etag }
}

function refresh(projectId: string, rootPath: string): Promise<ForgeStatus> {
  const running = inflight.get(projectId)
  if (running) return running

  const started = read(projectId, rootPath)
    .catch((cause: Error) => ({
      status: noted({
        code: 'forge.unreachable',
        severity: 'info',
        message: 'Pull request status is unavailable, so cards show local git only.',
        hint: cause.message,
      }),
      etag: null,
    }))
    .then(({ status, etag }) => {
      const previous = cache.get(projectId)
      cache.set(projectId, { status, filled: Date.now(), etag })
      inflight.delete(projectId)

      if (!previous || fingerprint(previous.status) !== fingerprint(status)) {
        for (const listener of listeners) listener(projectId, status)
      }

      return status
    })

  inflight.set(projectId, started)
  return started
}

export async function pulls(
  projectId: string,
  rootPath: string,
  force = false,
): Promise<ForgeStatus> {
  if (force) return refresh(projectId, rootPath)

  const entry = cache.get(projectId)
  if (!entry) return refresh(projectId, rootPath)

  if (Date.now() - entry.filled > FRESH_MS) return refresh(projectId, rootPath)

  return entry.status
}

export function forget(projectId: string): void {
  cache.delete(projectId)
  inflight.delete(projectId)
}

export function forgetAll(): void {
  cache.clear()
  inflight.clear()
}

const STATES = new Set<MergeState>([
  'clean',
  'blocked',
  'dirty',
  'behind',
  'unstable',
  'draft',
  'unknown',
])

function mergeStateOf(raw: string): MergeState {
  return STATES.has(raw as MergeState) ? (raw as MergeState) : 'unknown'
}

const WHY: Record<MergeState, string> = {
  clean: 'Ready to merge.',
  blocked: 'Blocked — a required review or check has not passed.',
  dirty: 'Conflicts with the base branch. Resolve them first.',
  behind: 'Behind the base branch, and this repository requires branches to be up to date.',
  unstable: 'A non-required check is failing. It can still be merged.',
  draft: 'Still a draft. Mark it ready for review first.',
  unknown: 'GitHub has not worked out whether this can be merged.',
}

export async function mergeability(rootPath: string, number: number): Promise<Mergeability> {
  const repo = await repoOf(rootPath)
  if (!repo) throw new Error('This repository has no GitHub remote.')

  const held = await credential()
  if (!held) throw new Error('Not signed in to GitHub.')

  const path = `/repos/${repo.owner}/${repo.name}/pulls/${number}`

  for (let attempt = 0; attempt < SETTLE_TRIES; attempt += 1) {
    const answered = await callApi(path, held.token)
    if (!answered.ok) throw new Error(remaining(answered.status, answered.said))

    const raw = answered.body as RawDetail | null
    if (!raw) throw new Error('GitHub returned nothing for that pull request.')

    if (raw.merged) {
      return {
        number,
        state: 'unknown',
        headSha: raw.head?.sha ?? '',
        reason: 'Already merged.',
      }
    }

    if (raw.mergeable !== null || attempt === SETTLE_TRIES - 1) {
      const state = mergeStateOf(raw.mergeable_state)
      return { number, state, headSha: raw.head?.sha ?? '', reason: WHY[state] }
    }

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  }

  return { number, state: 'unknown', headSha: '', reason: WHY.unknown }
}

export async function merge(
  rootPath: string,
  number: number,
  method: MergeMethod,
  sha: string,
): Promise<MergeOutcome> {
  const repo = await repoOf(rootPath)
  if (!repo) throw new Error('This repository has no GitHub remote.')

  const held = await credential()
  if (!held) throw new Error('Not signed in to GitHub.')

  const answered = await callApi(`/repos/${repo.owner}/${repo.name}/pulls/${number}/merge`, held.token, {
    method: 'PUT',
    body: { merge_method: method, sha },
  })

  if (answered.status === 409) {
    throw new Error(
      'The branch moved since this card was drawn, so nothing was merged. Refresh and look again.',
    )
  }

  if (answered.status === 405) {
    throw new Error(`GitHub refused the merge: ${answered.said}`)
  }

  if (!answered.ok) {
    throw new Error(remaining(answered.status, answered.said))
  }

  const raw = answered.body as { sha?: string; merged?: boolean; message?: string } | null

  return {
    merged: raw?.merged === true,
    sha: raw?.sha ?? null,
    message: raw?.message ?? 'Merged.',
  }
}
