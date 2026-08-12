import { open, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import type { CcwtConfig, ConfigView, Project } from '../../shared/types'
import type { ConfigIssue } from '../../shared/config-schema'
import { parseConfig } from '../../shared/config-schema'
import { configPath, loadConfig, suggestConfig } from './detect'
import { isInside } from './git'

const MAX_BYTES = 256 * 1024

export function serialise(config: CcwtConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

export async function readConfig(project: Project): Promise<ConfigView> {
  const path = configPath(project.rootPath)
  const source = await loadConfig(project.rootPath)
  const info = await stat(path).catch(() => null)

  if (source.state === 'absent') {
    const suggested = await suggestConfig(project.rootPath)
    return {
      path,
      exists: false,
      text: serialise(suggested),
      mtimeMs: null,
      config: suggested,
      issues: [],
      detected: true,
    }
  }

  if (source.state === 'invalid') {
    return {
      path,
      exists: true,
      text: source.text,
      mtimeMs: info?.mtimeMs ?? null,
      config: await suggestConfig(project.rootPath),
      issues: source.issues,
      detected: false,
    }
  }

  return {
    path,
    exists: true,
    text: source.text,
    mtimeMs: info?.mtimeMs ?? null,
    config: source.config,
    issues: [],
    detected: false,
  }
}

export class ConfigConflict extends Error {
  constructor() {
    super('This file changed on disk since you opened it. Reload before saving.')
    this.name = 'ConfigConflict'
  }
}

export class ConfigInvalid extends Error {
  readonly issues: ConfigIssue[]

  constructor(issues: ConfigIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
    this.name = 'ConfigInvalid'
    this.issues = issues
  }
}

async function target(project: Project): Promise<string> {
  const path = resolve(configPath(project.rootPath))

  if (!isInside(project.rootPath, path) || dirname(path) !== resolve(project.rootPath)) {
    throw new Error('Refusing to write outside the project root.')
  }

  return path
}

async function writeAtomic(path: string, content: string): Promise<number> {
  const temp = join(dirname(path), `.ccwt-${randomUUID()}.tmp`)

  try {
    const handle = await open(temp, 'w', 0o644)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temp, path)
  } catch (cause) {
    await rm(temp, { force: true })
    throw cause
  }

  const info = await stat(path)
  return info.mtimeMs
}

export interface WriteInput {
  text: string
  mtimeMs: number | null
}

export async function writeConfig(project: Project, input: WriteInput): Promise<ConfigView> {
  if (input.text.length > MAX_BYTES) {
    throw new Error(`A recipe over ${Math.round(MAX_BYTES / 1024)} KB is not something ccwt writes.`)
  }

  let value: unknown
  try {
    value = JSON.parse(input.text)
  } catch (cause) {
    throw new ConfigInvalid([{ path: '(root)', message: (cause as Error).message }])
  }

  const parsed = parseConfig(value)
  if (!parsed.ok) throw new ConfigInvalid(parsed.issues)

  const path = await target(project)
  const info = await stat(path).catch(() => null)
  const current = info?.mtimeMs ?? null

  if (current === null ? input.mtimeMs !== null : Math.abs(current - (input.mtimeMs ?? -1)) > 1) {
    throw new ConfigConflict()
  }

  await writeAtomic(path, serialise(parsed.config))
  return readConfig(project)
}
