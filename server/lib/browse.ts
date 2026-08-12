import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { DirEntry, DirListing, ProbeResult } from '../../shared/types'
import { defaultBranch, idFor, repoRoot } from './git'
import { pathExists } from './fs'
import { listRecords } from './store'

const MAX_ENTRIES = 500

const NOISE = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'vendor',
  'Library',
  'Applications',
  'System',
  '.Trash',
])

export function expandHome(input: string): string {
  const home = homedir()
  if (input === '~') return home
  if (input.startsWith('~/')) return join(home, input.slice(2))
  return input
}

export function shortenHome(path: string): string {
  const home = homedir()
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

async function isRepo(path: string): Promise<boolean> {
  return pathExists(join(path, '.git'))
}

export async function listDirectory(requested?: string): Promise<DirListing> {
  const home = homedir()
  const target = requested ? resolve(expandHome(requested)) : home

  const info = await stat(target).catch(() => null)
  if (!info?.isDirectory()) {
    throw new Error(`${shortenHome(target)} is not a directory.`)
  }

  const real = await realpath(target).catch(() => target)
  const known = new Set((await listRecords()).map((record) => record.rootPath))

  const names = await readdir(real, { withFileTypes: true }).catch(() => {
    throw new Error(`Cannot read ${shortenHome(real)}.`)
  })

  const directories = names
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name))

  const truncated = directories.length > MAX_ENTRIES
  const visible = directories.slice(0, MAX_ENTRIES)

  const entries: DirEntry[] = await Promise.all(
    visible.map(async (entry) => {
      const path = join(real, entry.name)
      const noise = NOISE.has(entry.name)
      const repo = noise ? false : await isRepo(path)

      return {
        name: entry.name,
        path,
        repo,
        branch: repo ? await defaultBranch(path) : null,
        known: known.has(path),
        noise,
        hidden: entry.name.startsWith('.'),
      }
    }),
  )

  return {
    path: real,
    parent: real === dirname(real) ? null : dirname(real),
    home,
    entries,
    truncated,
  }
}

export async function probe(input: string): Promise<ProbeResult> {
  const trimmed = input.trim()
  const empty: ProbeResult = { path: null, problem: null, known: false, branch: null }

  if (!trimmed) return empty

  const target = resolve(expandHome(trimmed))
  const info = await stat(target).catch(() => null)

  if (!info) return { ...empty, problem: 'That path does not exist.' }
  if (!info.isDirectory()) return { ...empty, problem: 'That is a file, not a directory.' }

  const root = await repoRoot(target)
  if (!root) return { ...empty, problem: 'That directory is not inside a git repository.' }

  const records = await listRecords()
  const already = records.some((record) => record.id === idFor(root))

  return {
    path: root,
    problem: already ? 'That project is already registered.' : null,
    known: already,
    branch: await defaultBranch(root),
  }
}
