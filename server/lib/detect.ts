import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CcwtConfig, PackageManager, ServiceConfig } from '../../shared/types'
import type { ConfigIssue } from '../../shared/config-schema'
import { parseConfigText } from '../../shared/config-schema'
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

export function defaultConfig(services: ServiceConfig[]): CcwtConfig {
  return {
    worktreesDir: '../.worktrees',
    packageManager: 'auto',
    provision: {
      dependencies: 'auto',
      copy: ['.env', '.env.local', '.env.development.local'],
      link: [],
      write: [],
      postCreate: [],
      postRemove: [],
    },
    services,
    claude: {
      ownWorktreeCreation: false,
    },
  }
}

export async function suggestConfig(rootPath: string): Promise<CcwtConfig> {
  const manager = (await detectPackageManager(rootPath)) ?? 'npm'
  const { detectServices } = await import('./services')

  return defaultConfig(await detectServices(rootPath, manager))
}

export type ConfigSource =
  | { state: 'absent' }
  | { state: 'ok'; config: CcwtConfig; text: string }
  | { state: 'invalid'; issues: ConfigIssue[]; text: string }

export function configPath(rootPath: string): string {
  return join(rootPath, 'ccwt.config.json')
}

export async function loadConfig(rootPath: string): Promise<ConfigSource> {
  const raw = await readFile(configPath(rootPath), 'utf8').catch(() => null)
  if (raw === null) return { state: 'absent' }

  const parsed = parseConfigText(raw)
  if (!parsed.ok) return { state: 'invalid', issues: parsed.issues, text: raw }

  return { state: 'ok', config: parsed.config, text: raw }
}

export async function resolveConfig(rootPath: string): Promise<CcwtConfig> {
  const source = await loadConfig(rootPath)
  return source.state === 'ok' ? source.config : suggestConfig(rootPath)
}
