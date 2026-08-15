import type { Diagnostic, ForgeStatus, PullRequest, PullState } from '../../shared/types'
import { exec } from './exec'

const FRESH_MS = 60_000
const CALL_MS = 8_000
const LIMIT = 100

const FIELDS = 'number,title,url,state,isDraft,headRefName'

interface RawPull {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  headRefName: string
}

interface Entry {
  status: ForgeStatus
  filled: number
}

const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<ForgeStatus>>()

function stateOf(raw: RawPull): PullState {
  if (raw.state === 'MERGED') return 'merged'
  if (raw.state === 'CLOSED') return 'closed'
  return raw.isDraft ? 'draft' : 'open'
}

function quiet(): ForgeStatus {
  return { at: new Date().toISOString(), pulls: {}, issues: [] }
}

function gh(rootPath: string, args: string[]) {
  return exec('gh', args, { cwd: rootPath, timeoutMs: CALL_MS }).catch(
    (cause: NodeJS.ErrnoException) => ({
      code: -1,
      stdout: '',
      stderr: cause.message,
      missing: cause.code === 'ENOENT',
    }),
  )
}

async function activeAccount(rootPath: string): Promise<string | null> {
  const said = await gh(rootPath, ['auth', 'status', '--active'])
  if (said.code !== 0) return null

  const found = `${said.stdout}${said.stderr}`.match(/Logged in to \S+ account (\S+)/)
  return found?.[1] ?? null
}

const ELSEWHERE = /no git remotes|known GitHub host|not a git repository/i
const UNAUTHENTICATED = /not logged in|gh auth login|authentication token|HTTP 401/i
const UNSEEN = /could not resolve to a repository|HTTP 404|SAML|permission/i

const STEER = 'Give that account access, or sign gh in as one that already has it.'

function plainly(said: string): string {
  return said
    .replace(/^GraphQL:\s*/i, '')
    .replace(/\s*\(repository\)\s*$/i, '')
    .split('\n')[0]!
    .trim()
}

async function unreachable(rootPath: string, said: string): Promise<ForgeStatus> {
  if (ELSEWHERE.test(said)) return quiet()

  const account = await activeAccount(rootPath)

  const issue: Diagnostic = {
    code: 'forge.unreachable',
    severity: 'info',
    message: 'Pull request status is unavailable, so cards show local git only.',
    hint: UNAUTHENTICATED.test(said)
      ? 'gh is not signed in. Run `gh auth login`.'
      : UNSEEN.test(said)
        ? account
          ? `gh is signed in as ${account}, which cannot see this repository. ${STEER}`
          : `gh cannot see this repository. ${STEER}`
        : account
          ? `gh is signed in as ${account} and said: ${plainly(said)}`
          : `gh said: ${plainly(said)}`,
  }

  return { at: new Date().toISOString(), pulls: {}, issues: [issue] }
}

async function read(rootPath: string): Promise<ForgeStatus> {
  const probe = await gh(rootPath, ['repo', 'view', '--json', 'nameWithOwner'])
  if ('missing' in probe && probe.missing) return quiet()
  if (probe.code !== 0) {
    return unreachable(rootPath, probe.stderr.trim() || 'gh could not read this repository.')
  }

  const listed = await gh(rootPath, [
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    String(LIMIT),
    '--json',
    FIELDS,
  ])
  if (listed.code !== 0) {
    return unreachable(rootPath, listed.stderr.trim() || `gh pr list exited ${listed.code}`)
  }

  let raw: RawPull[]
  try {
    raw = JSON.parse(listed.stdout) as RawPull[]
  } catch (cause) {
    return unreachable(rootPath, (cause as Error).message)
  }

  const pulls: Record<string, PullRequest> = {}
  for (const entry of raw) {
    if (!entry.headRefName || pulls[entry.headRefName]) continue
    pulls[entry.headRefName] = {
      number: entry.number,
      title: entry.title,
      url: entry.url,
      state: stateOf(entry),
    }
  }

  const issues: Diagnostic[] =
    raw.length < LIMIT
      ? []
      : [
          {
            code: 'forge.truncated',
            severity: 'warning',
            message: `Only the ${LIMIT} most recent pull requests were read, so an older one may be missing from a card.`,
          },
        ]

  return { at: new Date().toISOString(), pulls, issues }
}

function refresh(projectId: string, rootPath: string): Promise<ForgeStatus> {
  const running = inflight.get(projectId)
  if (running) return running

  const started = read(rootPath)
    .catch((cause: Error) => unreachable(rootPath, cause.message))
    .then((status) => {
      cache.set(projectId, { status, filled: Date.now() })
      inflight.delete(projectId)
      return status
    })

  inflight.set(projectId, started)
  return started
}

export async function pulls(projectId: string, rootPath: string): Promise<ForgeStatus> {
  const entry = cache.get(projectId)
  if (!entry) return refresh(projectId, rootPath)

  if (Date.now() - entry.filled > FRESH_MS) {
    refresh(projectId, rootPath).catch(() => undefined)
  }

  return entry.status
}

export function forget(projectId: string): void {
  cache.delete(projectId)
  inflight.delete(projectId)
}
