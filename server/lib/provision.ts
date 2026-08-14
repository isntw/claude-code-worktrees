import { cp, link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type {
  CcwtConfig,
  DependencyStrategy,
  PackageManager,
  WriteEntry,
} from '../../shared/types'
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
  written: string[]
  replaced: string[]
  pruned: string[]
  skipped: { path: string; reason: string }[]
  failed: { path: string; message: string }[]
}

function emptyReport(): ProvisionReport {
  return { copied: [], linked: [], written: [], replaced: [], pruned: [], skipped: [], failed: [] }
}

export interface Placeholders {
  project: string
  slug: string
  rootPath: string
  worktreePath: string
}

function fill(text: string, at: Placeholders): string {
  return text
    .replaceAll('{{project}}', at.project)
    .replaceAll('{{slug}}', at.slug)
    .replaceAll('{{rootPath}}', at.rootPath)
    .replaceAll('{{worktreePath}}', at.worktreePath)
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

function targetFor(worktreePath: string, entry: WriteEntry): string | null {
  const target = resolve(worktreePath, entry.path)
  const inside = resolve(worktreePath)
  return target === inside || target.startsWith(`${inside}/`) ? target : null
}

export async function writeFiles(
  worktreePath: string,
  entries: WriteEntry[],
  at: Placeholders,
  report: ProvisionReport,
): Promise<void> {
  for (const entry of entries) {
    const reason = unsafe(entry.path)
    if (reason) {
      report.skipped.push({ path: entry.path, reason })
      continue
    }

    const target = targetFor(worktreePath, entry)
    if (!target) {
      report.skipped.push({ path: entry.path, reason: 'resolves outside the worktree' })
      continue
    }

    try {
      if (await isSymlink(target)) {
        await rm(target, { force: true })
        report.replaced.push(entry.path)
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, fill(entry.content, at), 'utf8')
      report.written.push(entry.path)
    } catch (cause) {
      report.failed.push({ path: entry.path, message: (cause as Error).message })
    }
  }
}

export async function needsWriting(
  worktreePath: string,
  entries: WriteEntry[],
  at: Placeholders,
): Promise<boolean> {
  for (const entry of entries) {
    if (unsafe(entry.path)) continue

    const target = targetFor(worktreePath, entry)
    if (!target) continue

    const current = await readFile(target, 'utf8').catch(() => null)
    if (current !== fill(entry.content, at)) return true
  }

  return false
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

export async function runPostCreate(
  worktreePath: string,
  commands: string[],
  at: Placeholders,
): Promise<void> {
  for (const command of commands) {
    const rendered = fill(command, at)
    const parts = argv(rendered)
    const head = parts[0]
    if (!head) continue

    const result = await exec(head, parts.slice(1), { cwd: worktreePath, timeoutMs: 600_000 })

    if (result.code !== 0) {
      throw new Error(`postCreate \`${rendered}\` exited ${result.code}`)
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
  at: Placeholders,
): Promise<ProvisionReport> {
  const report = emptyReport()

  await copyFiles(rootPath, worktreePath, config.provision.copy, report)
  await linkPaths(rootPath, worktreePath, config.provision.link, report)
  await writeFiles(worktreePath, config.provision.write, at, report)
  await pruneCaches(worktreePath, report.linked, report)
  await installDependencies(rootPath, worktreePath, manager, config.provision.dependencies, report)
  await runPostCreate(worktreePath, config.provision.postCreate, at)

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
