import type { CcwtConfig, ConfigView, Project, RecipeCheck } from '../../shared/types'
import type { ConfigIssue } from '../../shared/config-schema'
import { RECIPE_REVISION, parseConfig } from '../../shared/config-schema'
import { configPath, loadConfig, suggestConfig } from './detect'
import { noteRecipe } from './lint'
import { findRecord, updateRecord } from './store'

const MAX_BYTES = 256 * 1024

export function serialise(config: CcwtConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

export async function readConfig(project: Project): Promise<ConfigView> {
  const record = await findRecord(project.id)

  if (record?.config) {
    const stored = parseConfig(record.config)
    const stale = (record.configRevision ?? 0) < RECIPE_REVISION

    if (stored.ok) {
      return {
        source: 'ccwt',
        path: null,
        text: serialise(stored.config),
        config: stored.config,
        issues: [],
        detected: false,
        stale,
      }
    }

    return {
      source: 'ccwt',
      path: null,
      text: serialise(record.config),
      config: await suggestConfig(project.rootPath),
      issues: stored.issues,
      detected: false,
      stale,
    }
  }

  const file = await loadConfig(project.rootPath)

  if (file.state === 'ok') {
    return {
      source: 'project',
      path: configPath(project.rootPath),
      text: file.text,
      config: file.config,
      issues: [],
      detected: false,
      stale: false,
    }
  }

  const suggested = await suggestConfig(project.rootPath)

  if (file.state === 'invalid') {
    return {
      source: 'project',
      path: configPath(project.rootPath),
      text: file.text,
      config: suggested,
      issues: file.issues,
      detected: false,
      stale: false,
    }
  }

  return {
    source: 'detected',
    path: null,
    text: serialise(suggested),
    config: suggested,
    issues: [],
    detected: true,
    stale: false,
  }
}

export function checkConfig(text: string): RecipeCheck {
  if (text.length > MAX_BYTES) {
    return {
      ok: false,
      issues: [
        {
          path: '(root)',
          message: `A recipe over ${Math.round(MAX_BYTES / 1024)} KB is not something ccwt keeps.`,
        },
      ],
      notes: [],
    }
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    return { ok: false, issues: [{ path: '(root)', message: (cause as Error).message }], notes: [] }
  }

  const parsed = parseConfig(value)
  if (!parsed.ok) return { ok: false, issues: parsed.issues, notes: [] }

  return { ok: true, issues: [], notes: noteRecipe(parsed.config) }
}

export class ConfigInvalid extends Error {
  readonly issues: ConfigIssue[]

  constructor(issues: ConfigIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
    this.name = 'ConfigInvalid'
    this.issues = issues
  }
}

export async function writeConfig(project: Project, text: string): Promise<ConfigView> {
  if (text.length > MAX_BYTES) {
    throw new Error(`A recipe over ${Math.round(MAX_BYTES / 1024)} KB is not something ccwt keeps.`)
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new ConfigInvalid([{ path: '(root)', message: (cause as Error).message }])
  }

  const parsed = parseConfig(value)
  if (!parsed.ok) throw new ConfigInvalid(parsed.issues)

  if (!(await updateRecord(project.id, { config: parsed.config, configRevision: RECIPE_REVISION }))) {
    throw new Error('No such project.')
  }

  return readConfig(project)
}

export async function resetConfig(project: Project): Promise<ConfigView> {
  await updateRecord(project.id, { config: undefined, configRevision: undefined })
  return readConfig(project)
}
