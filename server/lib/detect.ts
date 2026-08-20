import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackageManager, Provision, Recipe, Service } from '../../shared/types'
import { isDirectory, pathExists, readJsonSafe } from './fs'
import { isIgnored } from './git'

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
]

const DEV_SCRIPTS = ['dev', 'start', 'serve']

export const DEFAULT_PORT_RANGE: [number, number] = [5200, 5299]

export async function detectPackageManager(rootPath: string): Promise<PackageManager | null> {
  for (const [file, manager] of LOCKFILES) {
    if (await pathExists(join(rootPath, file))) return manager
  }

  const manifest = await readJsonSafe<{ packageManager?: string }>(join(rootPath, 'package.json'))
  const declared = manifest?.packageManager?.split('@')[0]
  if (declared === 'pnpm' || declared === 'npm' || declared === 'yarn' || declared === 'bun') {
    return declared
  }

  return (await pathExists(join(rootPath, 'package.json'))) ? 'npm' : null
}

export interface DevScript {
  name: string
  body: string
  multiProcess: boolean
}

export async function detectDevScript(rootPath: string): Promise<DevScript | null> {
  const manifest = await readJsonSafe<{ scripts?: Record<string, string> }>(
    join(rootPath, 'package.json'),
  )
  if (!manifest?.scripts) return null

  for (const name of DEV_SCRIPTS) {
    const body = manifest.scripts[name]
    if (body) return { name, body, multiProcess: isMultiProcess(body) }
  }
  return null
}

const MULTI_PROCESS = /(^|[\s"'])(concurrently|npm-run-all|run-p|run-s|turbo|nx|foreman|overmind)([\s"']|$)|&&|\|\|/

export function isMultiProcess(body: string): boolean {
  return MULTI_PROCESS.test(body)
}

export function devCommand(manager: PackageManager, script: string, body: string): string {
  const run = manager === 'npm' ? `npm run ${script}` : manager === 'bun' ? `bun run ${script}` : `${manager} ${script}`

  if (isMultiProcess(body)) return run

  const sep = manager === 'npm' ? ' -- ' : ' '
  return `${run}${sep}--port {{port}}`
}

export async function projectName(rootPath: string): Promise<string> {
  const manifest = await readJsonSafe<{ name?: string }>(join(rootPath, 'package.json'))
  const fromManifest = manifest?.name?.split('/').pop()
  return fromManifest || rootPath.split('/').filter(Boolean).pop() || rootPath
}

export function defaultRecipe(
  services: Service[],
  provision: Partial<Provision> = {},
): Recipe {
  return {
    worktreesDir: '.claude/worktrees',
    provision: {
      copy: [],
      link: [],
      write: [],
      postCreate: [],
      postRemove: [],
      ...provision,
    },
    services,
    claude: {
      ownWorktreeCreation: false,
    },
  }
}

export function suggestDependencies(
  manager: PackageManager | null,
): Pick<Provision, 'link' | 'postCreate'> {
  return { link: manager ? ['node_modules'] : [], postCreate: [] }
}

export async function detectCopies(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath).catch(() => [])
  const found: string[] = []

  for (const name of entries.sort()) {
    if (name !== '.env' && !name.startsWith('.env.')) continue
    if (await isDirectory(join(rootPath, name))) continue
    if (await isIgnored(rootPath, name)) found.push(name)
  }

  return found
}

export async function suggestRecipe(rootPath: string): Promise<Recipe> {
  const manager = await detectPackageManager(rootPath)
  const { detectServices } = await import('./services')

  return defaultRecipe(await detectServices(rootPath, manager ?? 'npm'), {
    copy: await detectCopies(rootPath),
    ...suggestDependencies(manager),
  })
}
