import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parse } from 'yaml'
import { pathExists } from './fs'

const FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'docker-compose.dev.yml',
  'docker-compose.dev.yaml',
  'compose.dev.yml',
  'docker-compose.worktree.yml',
]

const DIRECTORIES = ['.', 'docker', '.docker']

const VARIABLE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}$/

const IMAGE_KIND: [RegExp, ComposeService['kind']][] = [
  [/^(mysql|mariadb|postgres|postgis|mongo|mssql|cockroach)/, 'database'],
  [/^(redis|memcached|valkey)/, 'cache'],
  [/^(nginx|traefik|caddy|haproxy|envoy)/, 'proxy'],
  [/^(rabbitmq|kafka|nats|minio|elasticsearch|opensearch|mailhog|mailpit)/, 'support'],
]

export interface ComposePort {
  host: string
  container: string
  variable: string | null
  fallback: string | null
  fixed: boolean
}

export interface ComposeService {
  name: string
  image: string | null
  containerName: string | null
  built: boolean
  kind: 'app' | 'database' | 'cache' | 'proxy' | 'support' | 'other'
  ports: ComposePort[]
}

export interface ComposeFile {
  file: string
  path: string
  services: ComposeService[]
  externalNetworks: string[]
}

function readPort(entry: unknown): ComposePort | null {
  if (typeof entry === 'number') {
    return { host: String(entry), container: String(entry), variable: null, fallback: null, fixed: true }
  }

  let host: string | null = null
  let container = ''

  if (typeof entry === 'string') {
    const parts = entry.split(':')
    if (parts.length === 1) return null
    container = parts[parts.length - 1]!
    host = parts[parts.length - 2]!
  } else if (entry && typeof entry === 'object') {
    const long = entry as { published?: string | number; target?: string | number }
    if (long.published === undefined) return null
    host = String(long.published)
    container = String(long.target ?? '')
  }

  if (host === null) return null

  const match = VARIABLE.exec(host)
  if (match) {
    return {
      host,
      container,
      variable: match[1]!,
      fallback: match[2] ?? null,
      fixed: false,
    }
  }

  return { host, container, variable: null, fallback: null, fixed: /^\d+$/.test(host) }
}

function classify(image: string | null, built: boolean): ComposeService['kind'] {
  if (image) {
    const bare = image.replace(/^.*\//, '')
    for (const [pattern, kind] of IMAGE_KIND) {
      if (pattern.test(bare)) return kind
    }
  }
  return built ? 'app' : 'other'
}

export function parseCompose(text: string): ComposeService[] {
  let document: unknown
  try {
    document = parse(text)
  } catch {
    return []
  }

  const services = (document as { services?: Record<string, unknown> } | null)?.services
  if (!services || typeof services !== 'object') return []

  return Object.entries(services).map(([name, raw]) => {
    const value = (raw ?? {}) as {
      image?: string
      build?: unknown
      ports?: unknown[]
      container_name?: string
    }
    const image = typeof value.image === 'string' ? value.image : null
    const containerName = typeof value.container_name === 'string' ? value.container_name : null
    const built = value.build !== undefined

    const ports = Array.isArray(value.ports)
      ? value.ports.map(readPort).filter((port): port is ComposePort => port !== null)
      : []

    return { name, image, containerName, built, kind: classify(image, built), ports }
  })
}

export function externalNetworks(text: string): string[] {
  let document: unknown
  try {
    document = parse(text)
  } catch {
    return []
  }

  const networks = (document as { networks?: Record<string, unknown> } | null)?.networks
  if (!networks || typeof networks !== 'object') return []

  return Object.entries(networks)
    .filter(([, value]) => (value as { external?: unknown } | null)?.external === true)
    .map(([name]) => name)
}

export async function findCompose(rootPath: string): Promise<ComposeFile[]> {
  const found: ComposeFile[] = []

  for (const directory of DIRECTORIES) {
    for (const file of FILES) {
      const path = join(rootPath, directory, file)
      if (!(await pathExists(path))) continue

      const text = await readFile(path, 'utf8').catch(() => null)
      if (text === null) continue

      const services = parseCompose(text)
      if (services.length) {
        found.push({
          file: directory === '.' ? file : join(directory, file),
          path,
          services,
          externalNetworks: externalNetworks(text),
        })
      }
    }
  }

  return found
}

export function primaryPort(services: ComposeService[]): { service: string; port: ComposePort } | null {
  const order: ComposeService['kind'][] = ['proxy', 'app', 'other', 'support']

  for (const kind of order) {
    for (const service of services) {
      if (service.kind !== kind) continue
      const port = service.ports[0]
      if (port) return { service: service.name, port }
    }
  }

  for (const service of services) {
    const port = service.ports[0]
    if (port) return { service: service.name, port }
  }

  return null
}

export function composeCommand(file: string): string {
  return `docker compose -f ${file} up --remove-orphans`
}

export function fileLabel(path: string): string {
  return basename(path)
}

export interface PortPlan {
  service: string
  container: string
  host: number
  shared: boolean
}

export function portKey(serviceName: string, composeService: string, container: string): string {
  return `${serviceName}-${composeService}-${container}`.replace(/[^A-Za-z0-9-]+/g, '-')
}

export function publishedPorts(stack: ComposeFile): { service: string; container: string }[] {
  return stack.services.flatMap((service) =>
    service.ports.map((port) => ({
      service: service.name,
      container: port.container || port.host,
    })),
  )
}

export function buildOverride(
  services: ComposeService[],
  plans: PortPlan[],
  slug: string,
  shared: Set<string>,
): string {
  const byService = new Map<string, PortPlan[]>()

  for (const plan of plans) {
    if (plan.shared) continue
    byService.set(plan.service, [...(byService.get(plan.service) ?? []), plan])
  }

  const lines = ['# generated by ccwt — recreated on every start, edits are lost', 'services:']

  for (const service of services) {
    if (shared.has(service.name)) continue

    const ports = byService.get(service.name)
    const rename = service.containerName !== null

    if (!ports && !rename) continue

    lines.push(`  ${service.name}:`)
    if (rename) lines.push(`    container_name: ccwt-${slug}-${service.name}`)
    if (ports) {
      lines.push('    ports: !override')
      for (const port of ports) lines.push(`      - "${port.host}:${port.container}"`)
    }
  }

  return `${lines.join('\n')}\n`
}

export const OVERRIDE_FILE = '.ccwt.compose.yml'

export function composeUp(file: string, override: string, only: string[]): string {
  const services = only.length ? ` ${only.join(' ')}` : ''
  return `docker compose -f ${file} -f ${override} up --remove-orphans${services}`
}

export function composeDown(file: string, override: string): string {
  return `docker compose -f ${file} -f ${override} down --remove-orphans`
}
