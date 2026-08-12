import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parse } from 'yaml'
import { pathExists } from './fs'

export const WORKTREE_FILES = [
  'docker-compose.ccwt.yml',
  'docker-compose.ccwt.yaml',
  'compose.ccwt.yml',
  'docker-compose.worktree.yml',
]

const FILES = [
  ...WORKTREE_FILES,
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
  networks: string[]
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
    // ${VAR:-default} contains a colon, so mask the blocks before splitting on it
    const blocks: string[] = []
    const masked = entry.replace(/\$\{[^}]*\}/g, (block) => {
      blocks.push(block)
      return `\u0000${blocks.length - 1}\u0000`
    })
    const restore = (value: string) =>
      value.replace(/\u0000(\d+)\u0000/g, (_, index: string) => blocks[Number(index)] ?? '')

    const parts = masked.split(':')
    if (parts.length === 1) {
      return { host: '', container: restore(parts[0]!), variable: null, fallback: null, fixed: false }
    }
    container = restore(parts[parts.length - 1]!)
    host = restore(parts[parts.length - 2]!)
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
      networks?: unknown
    }
    const image = typeof value.image === 'string' ? value.image : null
    const containerName = typeof value.container_name === 'string' ? value.container_name : null
    const built = value.build !== undefined

    const ports = Array.isArray(value.ports)
      ? value.ports.map(readPort).filter((port): port is ComposePort => port !== null)
      : []

    const networks = Array.isArray(value.networks)
      ? value.networks.filter((n): n is string => typeof n === 'string')
      : value.networks && typeof value.networks === 'object'
        ? Object.keys(value.networks as Record<string, unknown>)
        : []

    return {
      name,
      image,
      containerName,
      networks: networks.length ? networks : ['default'],
      built,
      kind: classify(image, built),
      ports,
    }
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

export function fileLabel(path: string): string {
  return basename(path)
}


export interface PortVariable {
  name: string
  fallback: number | null
  service: string
  container: string
}

export function portVariables(stack: ComposeFile): PortVariable[] {
  const seen = new Set<string>()
  const out: PortVariable[] = []

  for (const service of stack.services) {
    for (const port of service.ports) {
      if (!port.variable || seen.has(port.variable)) continue
      seen.add(port.variable)

      const fallback = Number.parseInt(port.fallback ?? '', 10)
      out.push({
        name: port.variable,
        fallback: Number.isFinite(fallback) ? fallback : null,
        service: service.name,
        container: port.container || '',
      })
    }
  }

  return out
}

export function fixedPorts(stack: ComposeFile): { service: string; host: string }[] {
  return stack.services.flatMap((service) =>
    service.ports.filter((port) => port.fixed).map((port) => ({ service: service.name, host: port.host })),
  )
}

export function isWorktreeReady(file: string): boolean {
  return WORKTREE_FILES.some((name) => file.endsWith(name))
}

export function composeUp(file: string): string {
  return `docker compose -f ${file} up --remove-orphans`
}

export function composeDown(file: string): string {
  return `docker compose -f ${file} down --remove-orphans`
}

export function scaffold(stack: ComposeFile): string {
  const lines = [
    '# Worktree-ready compose file for ccwt.',
    '# Published ports read from the environment; ccwt gives each worktree its own.',
    '# Container-side ports are untouched, so DB_HOST=db / REDIS_HOST=redis keep working.',
    'services:',
  ]

  for (const service of stack.services) {
    lines.push(`  ${service.name}:`)
    if (service.image) lines.push(`    image: ${service.image}`)
    else if (service.built) lines.push('    build: .')

    if (service.ports.length) {
      lines.push('    ports:')
      for (const port of service.ports) {
        const variable = port.variable ?? `${service.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PORT`
        const fallback = port.variable ? (port.fallback ?? '') : port.host
        lines.push(`      - "\${${variable}${fallback ? `:-${fallback}` : ''}}:${port.container}"`)
      }
    }
  }

  return `${lines.join('\n')}\n`
}
