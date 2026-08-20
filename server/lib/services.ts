import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackageManager, Service } from '../../shared/types'
import { DEFAULT_PORT_RANGE, devCommand } from './detect'
import { isDirectory, readJsonSafe } from './fs'

export interface Manifest {
  name?: string
  scripts?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
}

export interface Candidate {
  name: string
  script: string
  body: string
  cwd: string
}

async function workspaceGlobs(rootPath: string): Promise<string[]> {
  const manifest = await readJsonSafe<Manifest>(join(rootPath, 'package.json'))
  const declared = Array.isArray(manifest?.workspaces)
    ? manifest.workspaces
    : (manifest?.workspaces?.packages ?? [])

  if (declared.length) return declared

  const yaml = await readFile(join(rootPath, 'pnpm-workspace.yaml'), 'utf8').catch(() => null)
  if (yaml === null) return []

  const globs: string[] = []
  let inPackages = false

  for (const line of yaml.split('\n')) {
    if (/^packages:/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages) {
      const match = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line)
      if (match) globs.push(match[1]!.trim())
      else if (/^\S/.test(line)) inPackages = false
    }
  }

  return globs
}

const DEV_NAMES = ['dev', 'start', 'serve']

export async function walkWorkspaces(rootPath: string): Promise<Candidate[]> {
  const globs = await workspaceGlobs(rootPath)
  if (!globs.length) return []

  const directories = new Set<string>()

  for (const glob of globs) {
    const base = glob.replace(/\/\*+$/, '')
    const full = join(rootPath, base)

    if (glob.includes('*')) {
      const { readdir } = await import('node:fs/promises')
      const children = await readdir(full, { withFileTypes: true }).catch(() => [])
      for (const child of children) {
        if (child.isDirectory()) directories.add(join(full, child.name))
      }
      continue
    }

    if (await isDirectory(full)) directories.add(full)
  }

  const candidates: Candidate[] = []

  for (const directory of [...directories].sort()) {
    const manifest = await readJsonSafe<Manifest>(join(directory, 'package.json'))
    if (!manifest?.scripts) continue

    const script = DEV_NAMES.find((name) => manifest.scripts?.[name])
    if (!script) continue

    candidates.push({
      name: (manifest.name?.split('/').pop() ?? directory.split('/').pop() ?? 'app').toLowerCase(),
      script,
      body: manifest.scripts[script]!,
      cwd: directory.slice(rootPath.length + 1) || '.',
    })
  }

  return candidates
}

export function toServices(candidates: Candidate[], manager: PackageManager): Service[] {
  const seen = new Set<string>()

  return candidates.map((candidate, index) => {
    let name = candidate.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'service'
    while (seen.has(name)) name = `${name}-${index}`
    seen.add(name)

    return {
      name,
      cwd: candidate.cwd,
      command: devCommand(manager, candidate.script, candidate.body),
      portRange: DEFAULT_PORT_RANGE,
    }
  })
}

export async function detectServices(
  rootPath: string,
  manager: PackageManager,
): Promise<Service[]> {
  const manifest = await readJsonSafe<Manifest>(join(rootPath, 'package.json'))
  const scripts = manifest?.scripts ?? {}

  for (const name of DEV_NAMES) {
    const body = scripts[name]
    if (!body) continue

    return toServices([{ name, script: name, body, cwd: '.' }], manager)
  }

  const workspaces = await walkWorkspaces(rootPath)
  if (workspaces.length) return toServices(workspaces, manager)

  return []
}
