import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CcwtConfig, PackageManager, ServiceConfig } from '../../shared/types'
import { pathExists, readJsonSafe } from './fs'

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

export async function detectDevScript(rootPath: string): Promise<string | null> {
  const manifest = await readJsonSafe<{ scripts?: Record<string, string> }>(
    join(rootPath, 'package.json'),
  )
  if (!manifest?.scripts) return null

  for (const name of DEV_SCRIPTS) {
    if (manifest.scripts[name]) return name
  }
  return null
}

export function devCommand(manager: PackageManager, script: string): string {
  if (manager === 'npm') return `npm run ${script} -- --port {{port}}`
  if (manager === 'bun') return `bun run ${script} --port {{port}}`
  return `${manager} ${script} --port {{port}}`
}

export async function projectName(rootPath: string): Promise<string> {
  const manifest = await readJsonSafe<{ name?: string }>(join(rootPath, 'package.json'))
  const fromManifest = manifest?.name?.split('/').pop()
  return fromManifest || rootPath.split('/').filter(Boolean).pop() || rootPath
}

export function defaultConfig(services: ServiceConfig[]): CcwtConfig {
  return {
    worktreesDir: '../.worktrees',
    packageManager: 'auto',
    provision: {
      dependencies: 'auto',
      copy: ['.env', '.env.local', '.env.development.local'],
      postCreate: [],
    },
    services,
    claude: {
      trackSessions: false,
      ownWorktreeCreation: false,
      launchCommand: 'claude',
    },
  }
}

export async function suggestConfig(rootPath: string): Promise<CcwtConfig> {
  const manager = (await detectPackageManager(rootPath)) ?? 'npm'
  const script = await detectDevScript(rootPath)

  const services: ServiceConfig[] = script
    ? [
        {
          name: 'web',
          cwd: '.',
          command: devCommand(manager, script),
          portRange: DEFAULT_PORT_RANGE,
        },
      ]
    : []

  return defaultConfig(services)
}

export async function loadConfig(rootPath: string): Promise<CcwtConfig | null> {
  const path = join(rootPath, 'ccwt.config.json')
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (raw === null) return null

  let parsed: Partial<CcwtConfig>
  try {
    parsed = JSON.parse(raw) as Partial<CcwtConfig>
  } catch {
    return null
  }

  const fallback = await suggestConfig(rootPath)

  return {
    worktreesDir: parsed.worktreesDir ?? fallback.worktreesDir,
    packageManager: parsed.packageManager ?? fallback.packageManager,
    provision: { ...fallback.provision, ...parsed.provision },
    services: parsed.services?.length ? parsed.services : fallback.services,
    claude: { ...fallback.claude, ...parsed.claude },
  }
}

export async function resolveConfig(rootPath: string): Promise<CcwtConfig> {
  return (await loadConfig(rootPath)) ?? (await suggestConfig(rootPath))
}
