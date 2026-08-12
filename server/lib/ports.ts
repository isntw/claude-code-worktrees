import { stub } from './stub'

export function hashToRange(_seed: string, _range: [number, number]): number {
  return stub('hashToRange', 1)
}

export function isFree(_port: number): Promise<boolean> {
  return stub('isFree', 1)
}

export function allocate(
  _worktreePath: string,
  _service: string,
  _range: [number, number],
): Promise<number> {
  return stub('allocate', 1)
}

export function release(_worktreePath: string, _service: string): Promise<void> {
  return stub('release', 1)
}

export function readAllocated(_worktreePath: string, _service: string): Promise<number | null> {
  return stub('readAllocated', 1)
}
