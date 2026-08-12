import type { Worktree } from '../../shared/types'
import { stub } from './stub'

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

export function repoRoot(_path: string): Promise<string | null> {
  return stub('repoRoot', 1)
}

export function listWorktrees(_rootPath: string): Promise<RawWorktree[]> {
  return stub('listWorktrees', 1)
}

export function addWorktree(
  _rootPath: string,
  _worktreePath: string,
  _branch: string,
): Promise<void> {
  return stub('addWorktree', 1)
}

export function removeWorktree(_rootPath: string, _worktreePath: string): Promise<void> {
  return stub('removeWorktree', 1)
}

export function isLocked(_worktreePath: string): Promise<boolean> {
  return stub('isLocked', 2)
}

export function readWorktreeConfig(_worktreePath: string, _key: string): Promise<string | null> {
  return stub('readWorktreeConfig', 1)
}

export function writeWorktreeConfig(
  _worktreePath: string,
  _key: string,
  _value: string,
): Promise<void> {
  return stub('writeWorktreeConfig', 1)
}

export function classify(_rootPath: string, _raw: RawWorktree): Worktree['origin'] {
  return stub('classify', 2)
}
