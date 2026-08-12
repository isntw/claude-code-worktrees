import { cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CcwtConfig, DependencyStrategy, PackageManager } from '../../shared/types'
import { argv, exec } from './exec'
import { copyInto, pathExists } from './fs'
import { stub } from './stub'

export const ALWAYS_PER_WORKTREE = [
  'node_modules/.vite',
  '.nuxt',
  '.output',
  '.turbo',
  'dist',
] as const

export type Strategy = Exclude<DependencyStrategy, 'auto'>

export function resolveStrategy(manager: PackageManager, requested: DependencyStrategy): Strategy {
  if (requested !== 'auto') return requested
  return manager === 'pnpm' || manager === 'bun' ? 'install' : 'hardlink'
}

export function readWorktreeInclude(_rootPath: string): Promise<string[]> {
  return stub('readWorktreeInclude', 2)
}

export async function copyFiles(
  rootPath: string,
  worktreePath: string,
  patterns: string[],
): Promise<string[]> {
  const copied: string[] = []

  for (const pattern of patterns) {
    if (pattern.includes('*') || pattern.includes('..')) continue
    if (await copyInto(rootPath, worktreePath, pattern)) copied.push(pattern)
  }

  return copied
}

async function hardlinkModules(rootPath: string, worktreePath: string): Promise<boolean> {
  const source = join(rootPath, 'node_modules')
  if (!(await pathExists(source))) return false

  const target = join(worktreePath, 'node_modules')

  if (process.platform !== 'win32') {
    const result = await exec('cp', ['-al', source, target], { timeoutMs: 120_000 }).catch(
      () => null,
    )
    if (result?.code === 0) return true
  }

  await cp(source, target, { recursive: true, force: false, errorOnExist: false })
  return true
}

export async function installDependencies(
  rootPath: string,
  worktreePath: string,
  manager: PackageManager,
  requested: DependencyStrategy,
): Promise<void> {
  const strategy = resolveStrategy(manager, requested)
  if (strategy === 'none') return

  if (strategy === 'copy' || strategy === 'hardlink') {
    await hardlinkModules(rootPath, worktreePath)
    if (strategy === 'copy') return
  }

  if (!(await pathExists(join(worktreePath, 'package.json')))) return

  const result = await exec(manager, ['install'], {
    cwd: worktreePath,
    timeoutMs: 600_000,
  })

  if (result.code !== 0) {
    throw new Error(result.stderr.trim().split('\n').slice(-5).join('\n') || `${manager} install exited ${result.code}`)
  }
}

export async function runPostCreate(worktreePath: string, commands: string[]): Promise<void> {
  for (const command of commands) {
    const parts = argv(command)
    const head = parts[0]
    if (!head) continue

    const result = await exec(head, parts.slice(1), {
      cwd: worktreePath,
      timeoutMs: 600_000,
    })

    if (result.code !== 0) {
      throw new Error(`postCreate \`${command}\` exited ${result.code}`)
    }
  }
}

export async function provision(
  rootPath: string,
  worktreePath: string,
  manager: PackageManager,
  config: CcwtConfig,
): Promise<string[]> {
  const copied = await copyFiles(rootPath, worktreePath, config.provision.copy)
  await installDependencies(rootPath, worktreePath, manager, config.provision.dependencies)
  await runPostCreate(worktreePath, config.provision.postCreate)
  return copied
}

export function worktreesDirFor(rootPath: string, config: CcwtConfig): string {
  return resolve(rootPath, config.worktreesDir)
}

export function worktreePathFor(
  rootPath: string,
  config: CcwtConfig,
  projectSlug: string,
  slug: string,
): string {
  return join(worktreesDirFor(rootPath, config), projectSlug, slug)
}
