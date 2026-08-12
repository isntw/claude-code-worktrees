import { cp, link, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { CcwtConfig, DependencyStrategy, PackageManager } from '../../shared/types'
import { argv, exec } from './exec'
import { isDirectory, isSymlink, pathExists } from './fs'
import { stub } from './stub'

export const ALWAYS_PER_WORKTREE = [
  'node_modules/.vite',
  'node_modules/.cache',
  '.nuxt',
  '.output',
  '.turbo',
  '.next',
  'dist',
] as const

export type Strategy = Exclude<DependencyStrategy, 'auto'>

export interface ProvisionReport {
  copied: string[]
  linked: string[]
  replaced: string[]
  pruned: string[]
  skipped: { path: string; reason: string }[]
  failed: { path: string; message: string }[]
}

function emptyReport(): ProvisionReport {
  return { copied: [], linked: [], replaced: [], pruned: [], skipped: [], failed: [] }
}

export function resolveStrategy(manager: PackageManager, requested: DependencyStrategy): Strategy {
  if (requested !== 'auto') return requested
  return manager === 'pnpm' || manager === 'bun' ? 'install' : 'hardlink'
}

export function readWorktreeInclude(_rootPath: string): Promise<string[]> {
  return stub('readWorktreeInclude', 2)
}

function unsafe(path: string): string | null {
  if (!path.trim()) return 'empty path'
  if (path.includes('*')) return 'patterns are not supported yet'
  if (path.includes('..')) return 'paths must stay inside the project'
  if (path.startsWith('/')) return 'paths must be relative to the project root'
  return null
}

export async function copyFiles(
  rootPath: string,
  worktreePath: string,
  entries: string[],
  report: ProvisionReport,
): Promise<void> {
  for (const entry of entries) {
    const reason = unsafe(entry)
    if (reason) {
      report.skipped.push({ path: entry, reason })
      continue
    }

    const source = join(rootPath, entry)
    if (!(await pathExists(source))) continue

    const target = join(worktreePath, entry)
    if (await replaceSymlink(target, entry, report)) continue

    try {
      await mkdir(dirname(target), { recursive: true })
      await cp(source, target, { recursive: true, errorOnExist: false, force: false })
      report.copied.push(entry)
    } catch (cause) {
      report.failed.push({ path: entry, message: (cause as Error).message })
    }
  }
}

async function replaceSymlink(
  target: string,
  entry: string,
  report: ProvisionReport,
): Promise<boolean> {
  if (await isSymlink(target)) {
    await rm(target, { force: true })
    report.replaced.push(entry)
    return false
  }

  if (await pathExists(target)) {
    report.skipped.push({ path: entry, reason: 'already in the worktree' })
    return true
  }

  return false
}

async function hardlinkTree(source: string, target: string): Promise<void> {
  if (process.platform !== 'win32') {
    const result = await exec('cp', ['-al', source, target], { timeoutMs: 300_000 }).catch(
      () => null,
    )
    if (result?.code === 0) return
  }

  await cp(source, target, { recursive: true, force: false, errorOnExist: false })
}

export async function linkPaths(
  rootPath: string,
  worktreePath: string,
  entries: string[],
  report: ProvisionReport,
): Promise<void> {
  for (const entry of entries) {
    const reason = unsafe(entry)
    if (reason) {
      report.skipped.push({ path: entry, reason })
      continue
    }

    if ((ALWAYS_PER_WORKTREE as readonly string[]).includes(entry)) {
      report.skipped.push({ path: entry, reason: 'build caches are always per-worktree' })
      continue
    }

    const source = join(rootPath, entry)
    if (!(await pathExists(source))) continue

    const target = join(worktreePath, entry)
    if (await replaceSymlink(target, entry, report)) continue

    try {
      await mkdir(dirname(target), { recursive: true })

      if (await isDirectory(source)) await hardlinkTree(source, target)
      else await link(source, target).catch(() => cp(source, target))

      report.linked.push(entry)
    } catch (cause) {
      report.failed.push({ path: entry, message: (cause as Error).message })
    }
  }
}

export async function pruneCaches(
  worktreePath: string,
  linked: string[],
  report: ProvisionReport,
): Promise<void> {
  for (const cache of ALWAYS_PER_WORKTREE) {
    const nested = linked.some((entry) => cache === entry || cache.startsWith(`${entry}/`))
    if (!nested) continue

    const target = join(worktreePath, cache)
    if (!(await pathExists(target))) continue

    await rm(target, { recursive: true, force: true }).catch(() => undefined)
    report.pruned.push(cache)
  }
}

export async function installDependencies(
  rootPath: string,
  worktreePath: string,
  manager: PackageManager,
  requested: DependencyStrategy,
  report: ProvisionReport,
): Promise<void> {
  const strategy = resolveStrategy(manager, requested)
  if (strategy === 'none') return

  if (strategy === 'copy' || strategy === 'hardlink') {
    const before = report.linked.length
    await linkPaths(rootPath, worktreePath, ['node_modules'], report)
    if (report.linked.length > before) await pruneCaches(worktreePath, ['node_modules'], report)
    if (strategy === 'copy') return
  }

  if (!(await pathExists(join(worktreePath, 'package.json')))) return

  const result = await exec(manager, ['install'], { cwd: worktreePath, timeoutMs: 600_000 })

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim().split('\n').slice(-5).join('\n') ||
        `${manager} install exited ${result.code}`,
    )
  }
}

export async function runPostCreate(worktreePath: string, commands: string[]): Promise<void> {
  for (const command of commands) {
    const parts = argv(command)
    const head = parts[0]
    if (!head) continue

    const result = await exec(head, parts.slice(1), { cwd: worktreePath, timeoutMs: 600_000 })

    if (result.code !== 0) {
      throw new Error(`postCreate \`${command}\` exited ${result.code}`)
    }
  }
}

export async function runPostRemove(worktreePath: string, command: string): Promise<void> {
  const parts = argv(command)
  const head = parts[0]
  if (!head) return

  await exec(head, parts.slice(1), { cwd: worktreePath, timeoutMs: 120_000 })
}

export async function provision(
  rootPath: string,
  worktreePath: string,
  manager: PackageManager,
  config: CcwtConfig,
): Promise<ProvisionReport> {
  const report = emptyReport()

  await copyFiles(rootPath, worktreePath, config.provision.copy, report)
  await linkPaths(rootPath, worktreePath, config.provision.link, report)
  await pruneCaches(worktreePath, report.linked, report)
  await installDependencies(rootPath, worktreePath, manager, config.provision.dependencies, report)
  await runPostCreate(worktreePath, config.provision.postCreate)

  return report
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
