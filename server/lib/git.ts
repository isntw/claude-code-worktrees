import { createHash } from 'node:crypto'
import { resolve, sep } from 'node:path'
import type { GitReport, GitStatus, WorktreeOrigin } from '../../shared/types'
import { git, gitOut } from './exec'

const CLAUDE_WORKTREE_DIR = '.claude/worktrees'

export interface RawWorktree {
  path: string
  head: string | null
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  lockReason: string | null
  prunable: boolean
}

export function idFor(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 12)
}

export function isInside(parent: string, child: string): boolean {
  const a = resolve(parent)
  const b = resolve(child)
  return b === a || b.startsWith(a.endsWith(sep) ? a : a + sep)
}

export async function repoRoot(path: string): Promise<string | null> {
  const top = await gitOut(path, ['rev-parse', '--show-toplevel'])
  return top ? resolve(top) : null
}

export async function defaultBranch(rootPath: string): Promise<string | null> {
  const head = await gitOut(rootPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (head) return head
  return gitOut(rootPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

export async function branchExists(rootPath: string, branch: string): Promise<boolean> {
  const result = await git(rootPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
  return result.code === 0
}

const HEADERS = {
  head: '# branch.head ',
  upstream: '# branch.upstream ',
  ab: '# branch.ab ',
} as const

export async function readStatus(worktreePath: string): Promise<GitStatus | null> {
  const out = await gitOut(worktreePath, ['status', '--porcelain=v2', '--branch'])
  if (out === null) return null

  const status: GitStatus = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  }

  for (const line of out.split('\n')) {
    if (line.startsWith(HEADERS.head)) {
      const value = line.slice(HEADERS.head.length)
      status.branch = value === '(detached)' ? null : value
      continue
    }

    if (line.startsWith(HEADERS.upstream)) {
      status.upstream = line.slice(HEADERS.upstream.length) || null
      continue
    }

    if (line.startsWith(HEADERS.ab)) {
      const found = line.slice(HEADERS.ab.length).match(/^\+(\d+) -(\d+)$/)
      if (found?.[1] && found[2]) {
        status.ahead = Number(found[1])
        status.behind = Number(found[2])
      }
      continue
    }

    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4)
      if (xy.length !== 2) continue
      if (xy[0] !== '.') status.staged += 1
      if (xy[1] !== '.') status.unstaged += 1
      continue
    }

    if (line.startsWith('u ')) status.conflicted += 1
    else if (line.startsWith('? ')) status.untracked += 1
  }

  if (!status.upstream && status.branch) {
    const remote = `origin/${status.branch}`
    const found = await git(worktreePath, ['rev-parse', '--verify', '--quiet', `${remote}^{commit}`])

    if (found.code === 0) {
      const counts = await gitOut(worktreePath, [
        'rev-list',
        '--left-right',
        '--count',
        `${remote}...HEAD`,
      ])
      const [behind, ahead] = (counts ?? '').split(/\s+/)

      if (behind !== undefined && ahead !== undefined) {
        status.upstream = remote
        status.behind = Number(behind)
        status.ahead = Number(ahead)
      }
    }
  }

  return status
}

export async function statusReport(rootPath: string): Promise<GitReport> {
  const raw = await listWorktrees(rootPath)

  const found = await Promise.all(
    raw
      .filter((entry) => !entry.bare)
      .map(async (entry) => [idFor(entry.path), await readStatus(entry.path)] as const),
  )

  const report: GitReport = {}
  for (const [id, status] of found) {
    if (status) report[id] = status
  }
  return report
}

export async function listWorktrees(rootPath: string): Promise<RawWorktree[]> {
  const out = await gitOut(rootPath, ['worktree', 'list', '--porcelain'])
  if (out === null) return []

  const worktrees: RawWorktree[] = []
  let current: RawWorktree | null = null

  for (const line of out.split('\n')) {
    if (line === '') {
      if (current) worktrees.push(current)
      current = null
      continue
    }

    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1)

    if (key === 'worktree') {
      if (current) worktrees.push(current)
      current = {
        path: resolve(value),
        head: null,
        branch: null,
        bare: false,
        detached: false,
        locked: false,
        lockReason: null,
        prunable: false,
      }
      continue
    }

    if (!current) continue

    if (key === 'HEAD') current.head = value
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'bare') current.bare = true
    else if (key === 'detached') current.detached = true
    else if (key === 'locked') {
      current.locked = true
      current.lockReason = value || null
    } else if (key === 'prunable') current.prunable = true
  }

  if (current) worktrees.push(current)
  return worktrees
}

export function classify(
  rootPath: string,
  worktreesDir: string,
  worktreePath: string,
): WorktreeOrigin {
  if (resolve(worktreePath) === resolve(rootPath)) return 'manual'
  if (isInside(resolve(rootPath, CLAUDE_WORKTREE_DIR), worktreePath)) return 'claude'
  if (isInside(worktreesDir, worktreePath)) return 'ccwt'
  return 'manual'
}

export async function addWorktree(
  rootPath: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  const exists = await branchExists(rootPath, branch)
  const args = exists
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath]

  const result = await git(rootPath, args)
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git worktree add exited ${result.code}`)
  }
}

export async function removeWorktree(rootPath: string, worktreePath: string): Promise<void> {
  const result = await git(rootPath, ['worktree', 'remove', '--force', worktreePath])
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git worktree remove exited ${result.code}`)
  }
}

export async function pruneWorktrees(rootPath: string): Promise<void> {
  await git(rootPath, ['worktree', 'prune'])
}

export async function deleteBranch(rootPath: string, branch: string): Promise<string | null> {
  const result = await git(rootPath, ['branch', '-d', branch])
  if (result.code === 0) return null
  return result.stderr.trim() || `git branch -d exited ${result.code}`
}

export async function lockWorktree(
  rootPath: string,
  worktreePath: string,
  reason: string,
): Promise<void> {
  const result = await git(rootPath, ['worktree', 'lock', '--reason', reason, worktreePath])
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git worktree lock exited ${result.code}`)
  }
}

export async function unlockWorktree(rootPath: string, worktreePath: string): Promise<void> {
  const result = await git(rootPath, ['worktree', 'unlock', worktreePath])
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git worktree unlock exited ${result.code}`)
  }
}

export async function isLocked(rootPath: string, worktreePath: string): Promise<boolean> {
  const worktrees = await listWorktrees(rootPath)
  const match = worktrees.find((worktree) => worktree.path === resolve(worktreePath))
  return match?.locked ?? false
}

export async function isIgnored(worktreePath: string, path: string): Promise<boolean> {
  const result = await git(worktreePath, ['check-ignore', '-q', '--', path]).catch(() => null)
  return result?.code === 0
}

export async function enableWorktreeConfig(rootPath: string): Promise<void> {
  const current = await gitOut(rootPath, ['config', '--local', '--get', 'extensions.worktreeConfig'])
  if (current === 'true') return
  await git(rootPath, ['config', '--local', 'extensions.worktreeConfig', 'true'])
}

export async function localKeys(rootPath: string, pattern: string): Promise<string[]> {
  const found = await gitOut(rootPath, ['config', '--local', '--name-only', '--get-regexp', pattern])
  if (!found) return []
  return found.split('\n').map((line) => line.trim()).filter(Boolean)
}

export async function clearLocalConfig(rootPath: string, key: string): Promise<void> {
  await git(rootPath, ['config', '--local', '--unset-all', key])
}

export async function readWorktreeConfig(
  worktreePath: string,
  key: string,
): Promise<string | null> {
  return gitOut(worktreePath, ['config', '--worktree', '--get', key])
}

export async function writeWorktreeConfig(
  worktreePath: string,
  key: string,
  value: string,
): Promise<void> {
  const result = await git(worktreePath, ['config', '--worktree', key, value])
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git config --worktree ${key} exited ${result.code}`)
  }
}

export async function clearWorktreeConfig(worktreePath: string, key: string): Promise<void> {
  await git(worktreePath, ['config', '--worktree', '--unset', key])
}
