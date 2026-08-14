export const COMPOSE = /^(docker|podman)\s+compose\b|^docker-compose\b/

export const DEFAULT_COMPOSE_FILE = 'compose.ccwt.yml'

const invocation = (file: string) =>
  `docker compose -f ${file || DEFAULT_COMPOSE_FILE} --project-directory .`

export function composeFileOf(command: string): string {
  return /-f\s+(\S+)/.exec(command)?.[1] ?? ''
}

export function composeCommand(file: string, verb: 'up' | 'down'): string {
  return `${invocation(file)} ${verb}`
}

export function teardownCommand(file: string): string {
  return `${composeCommand(file, 'down')} -v`
}

export function composeExec(file: string, container: string, inner: string): string {
  return `${invocation(file)} exec -T ${container} ${inner}`
}

const EXEC = /^docker compose -f (\S+) --project-directory \. exec -T (\S+) (.+)$/

export interface ComposeExec {
  container: string
  command: string
}

export function readComposeExec(entry: string): ComposeExec {
  const found = EXEC.exec(entry)
  return found ? { container: found[2]!, command: found[3]! } : { container: '', command: entry }
}

export function isStack(kind: string | undefined, command: string): boolean {
  return (kind ?? (COMPOSE.test(command) ? 'stack' : 'command')) === 'stack'
}

export interface StackPart {
  name: string
  variable: string | null
  primary: boolean
}

interface Step {
  container: string
  key: string | null
  indent: number
  trimmed: string
}

function* walk(text: string): Generator<Step> {
  let inside = false
  let depth = -1
  let container = ''

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const indent = line.length - line.trimStart().length

    if (!inside) {
      if (indent === 0 && /^services\s*:/.test(trimmed)) inside = true
      continue
    }

    if (indent === 0) return

    const key = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:/.exec(trimmed)?.[1] ?? null

    if (key && depth === -1) depth = indent
    if (key && indent === depth) container = key

    yield { container, key, indent, trimmed }
  }
}

export function serviceNames(text: string): string[] {
  const found = new Set<string>()

  for (const step of walk(text)) {
    if (step.container) found.add(step.container)
  }

  return [...found]
}

export function containerFor(text: string, variable: string): string | null {
  const needle = `$\{${variable}`
  let portsAt = -1
  let within = ''

  for (const step of walk(text)) {
    if (step.container !== within) {
      within = step.container
      portsAt = -1
    }

    if (portsAt !== -1 && step.indent <= portsAt) portsAt = -1

    if (step.key === 'ports') {
      portsAt = step.indent
      if (step.trimmed.includes(needle)) return step.container
      continue
    }

    if (portsAt !== -1 && step.trimmed.includes(needle)) return step.container
  }

  return null
}

export const COMPOSE_SKELETON = [
  'services:',
  '  web:',
  '    build: .',
  '    ports: ["${WEB_PORT:-8080}:80"]',
  '',
].join('\n')
