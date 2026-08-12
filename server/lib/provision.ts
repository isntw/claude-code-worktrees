import type { CcwtConfig, DependencyStrategy, PackageManager } from '../../shared/types'
import { stub } from './stub'

export const ALWAYS_PER_WORKTREE = [
  'node_modules/.vite',
  '.nuxt',
  '.output',
  '.turbo',
  'dist',
] as const

export function resolveStrategy(
  _manager: PackageManager,
  _requested: DependencyStrategy,
): Exclude<DependencyStrategy, 'auto'> {
  return stub('resolveStrategy', 1)
}

export function readWorktreeInclude(_rootPath: string): Promise<string[]> {
  return stub('readWorktreeInclude', 2)
}

export function copyFiles(
  _rootPath: string,
  _worktreePath: string,
  _patterns: string[],
): Promise<string[]> {
  return stub('copyFiles', 1)
}

export function installDependencies(
  _rootPath: string,
  _worktreePath: string,
  _manager: PackageManager,
  _strategy: DependencyStrategy,
): Promise<void> {
  return stub('installDependencies', 1)
}

export function runPostCreate(_worktreePath: string, _commands: string[]): Promise<void> {
  return stub('runPostCreate', 1)
}

export function provision(_worktreePath: string, _config: CcwtConfig): Promise<void> {
  return stub('provision', 1)
}
