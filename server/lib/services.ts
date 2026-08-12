import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackageManager, ServiceConfig } from '../../shared/types'
import { DEFAULT_PORT_RANGE, devCommand, isMultiProcess } from './detect'
import { OVERRIDE_FILE, composeDown, composeUp, findCompose, primaryPort } from './compose'
import { argv } from './exec'
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

const RUNNERS = new Set(['concurrently', 'npm-run-all', 'run-p', 'run-s', 'npm-run-all2'])

function stripFlagValues(parts: string[]): { names: string[]; rest: string[] } {
  const names: string[] = []
  const rest: string[] = []

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!

    if (part === '-n' || part === '--names') {
      names.push(...(parts[index + 1] ?? '').split(',').filter(Boolean))
      index += 1
      continue
    }
    if (part === '-c' || part === '--prefix-colors' || part === '--kill-others-on-fail') {
      if (part !== '--kill-others-on-fail') index += 1
      continue
    }
    if (part.startsWith('-')) continue

    rest.push(part)
  }

  return { names, rest }
}

function expand(pattern: string, scripts: Record<string, string>): string[] {
  if (!pattern.includes('*')) return scripts[pattern] ? [pattern] : []

  const matcher = new RegExp(`^${pattern.split('*').map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return Object.keys(scripts).filter((name) => matcher.test(name))
}

export function parseComposite(body: string, scripts: Record<string, string>): Candidate[] {
  const parts = argv(body)
  const head = parts[0]
  if (!head || !RUNNERS.has(head)) return []

  const { names, rest } = stripFlagValues(parts.slice(1))

  const targets: string[] = []
  for (const token of rest) {
    const ref = token.replace(/^(?:npm|pnpm|yarn|bun):/, '')
    for (const script of expand(ref, scripts)) {
      if (!targets.includes(script)) targets.push(script)
    }
  }

  return targets.map((script, index) => ({
    name: names[index] ?? script.split(':').pop() ?? script,
    script,
    body: scripts[script] ?? '',
    cwd: '.',
  }))
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

export function toServices(candidates: Candidate[], manager: PackageManager): ServiceConfig[] {
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

export async function composeService(rootPath: string): Promise<ServiceConfig | null> {
  const files = await findCompose(rootPath)
  const chosen = files[0]
  if (!chosen) return null

  const primary = primaryPort(chosen.services)
  const base = primary?.port.fallback ?? primary?.port.host ?? ''
  const start = Number.parseInt(base, 10)

  return {
    name: 'compose',
    cwd: '.',
    command: composeUp(chosen.file, OVERRIDE_FILE, []),
    stopCommand: composeDown(chosen.file, OVERRIDE_FILE),
    portRange: Number.isFinite(start) ? [start, start + 99] : DEFAULT_PORT_RANGE,
    env: { COMPOSE_PROJECT_NAME: 'ccwt-{{slug}}' },
    compose: { file: chosen.file, isolate: 'all', shared: [] },
  }
}

export async function detectServices(
  rootPath: string,
  manager: PackageManager,
): Promise<ServiceConfig[]> {
  const compose = await composeService(rootPath)
  const node = await detectNodeServices(rootPath, manager)

  return compose ? [compose, ...node] : node
}

async function detectNodeServices(
  rootPath: string,
  manager: PackageManager,
): Promise<ServiceConfig[]> {
  const manifest = await readJsonSafe<Manifest>(join(rootPath, 'package.json'))
  const scripts = manifest?.scripts ?? {}

  for (const name of DEV_NAMES) {
    const body = scripts[name]
    if (!body) continue

    if (isMultiProcess(body)) {
      const parsed = parseComposite(body, scripts)
      if (parsed.length > 1) return toServices(parsed, manager)
    }

    return toServices([{ name: 'web', script: name, body, cwd: '.' }], manager)
  }

  const workspaces = await walkWorkspaces(rootPath)
  if (workspaces.length) return toServices(workspaces, manager)

  return []
}
