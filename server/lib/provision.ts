import { cp, link, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { CcwtConfig, WriteEntry } from '../../shared/types'
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
  merge = false,
): Promise<boolean> {
  if (await isSymlink(target)) {
    await rm(target, { force: true })
    report.replaced.push(entry)
    return false
  }

  if (await pathExists(target)) {
    if (merge && (await isDirectory(target))) return false
    report.skipped.push({ path: entry, reason: 'already in the worktree' })
    return true
  }

  return false
}

export async function missingBeneath(source: string, target: string): Promise<boolean> {
  const here = await readdir(source).catch(() => null)
  if (!here) return false

  const there = await readdir(target).catch(() => null)
  if (!there) return true

  const have = new Set(there)
  return here.some((name) => !have.has(name))
}

function cannotHardlink(detail: string): Error {
  return new Error(
    `could not hardlink — ${detail}\nMove it under \`copy\` in the recipe if this path cannot be shared with the root checkout.`,
  )
}

function alreadyLinked(stderr: string): boolean {
  const lines = stderr
    .trim()
    .split('\n')
    .filter((line) => line.trim())

  return lines.length > 0 && lines.every((line) => /are identical \(not copied\)\.$/.test(line.trim()))
}

async function hardlinkTree(source: string, target: string): Promise<void> {
  if (process.platform === 'win32') throw cannotHardlink('this platform cannot hardlink a directory tree')

  const merging = await pathExists(target)
  const args = merging ? ['-aln', `${source}/.`, target] : ['-al', source, target]
  const result = await exec('cp', args, { timeoutMs: 300_000 }).catch(() => null)

  if (result?.code === 0) return
  if (result && merging && alreadyLinked(result.stderr)) return

  const detail = result
    ? result.stderr.trim().split('\n').slice(-3).join('\n') || `\`cp\` exited ${result.code}`
    : '`cp` could not be run'

  throw cannotHardlink(detail)
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
    const directory = await isDirectory(source)

    if (await replaceSymlink(target, entry, report, directory)) continue

    try {
      await mkdir(dirname(target), { recursive: true })

      if (directory) await hardlinkTree(source, target)
      else
        await link(source, target).catch((cause: Error) => {
          throw cannotHardlink(cause.message)
        })

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
      const tail = (result.stderr.trim() || result.stdout.trim()).split('\n').slice(-5).join('\n')
      throw new Error(
        tail
          ? `\`${rendered}\` exited ${result.code}\n${tail}`
          : `\`${rendered}\` exited ${result.code}`,
      )
    }
  }
}

export async function runPostRemove(
  worktreePath: string,
  command: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const parts = argv(command)
  const head = parts[0]
  if (!head) return

  await exec(head, parts.slice(1), { cwd: worktreePath, env, timeoutMs: 120_000 })
}

export async function placeFiles(
  rootPath: string,
  worktreePath: string,
  config: CcwtConfig,
  at: Placeholders,
): Promise<ProvisionReport> {
  const report = emptyReport()

  await copyFiles(rootPath, worktreePath, config.provision.copy, report)
  await linkPaths(rootPath, worktreePath, config.provision.link, report)
  await writeFiles(worktreePath, config.provision.write, at, report)
  await pruneCaches(worktreePath, report.linked, report)

  return report
}

export async function provision(
  rootPath: string,
  worktreePath: string,
  config: CcwtConfig,
  at: Placeholders,
): Promise<ProvisionReport> {
  const report = await placeFiles(rootPath, worktreePath, config, at)
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
