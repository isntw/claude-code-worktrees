import { resolve } from 'node:path'
import type { Diagnostic, Project } from '../../shared/types'
import { detectPackageManager, loadConfig, projectName, suggestConfig } from './detect'
import { defaultBranch, idFor, repoRoot } from './git'
import { pathExists } from './fs'
import { RECIPE_REVISION } from '../../shared/config-schema'
import { findCompose, portVariables } from './compose'
import { describeSetup } from './setup'
import { addRecord, findRecord, listRecords, removeRecord } from './store'
import type { ProjectRecord } from './store'

export async function hydrate(record: ProjectRecord): Promise<Project> {
  const issues: Diagnostic[] = []

  if (!(await pathExists(record.rootPath))) {
    issues.push({
      code: 'project.missing',
      severity: 'error',
      message: 'This path no longer exists.',
      hint: 'Remove the project, or restore the directory.',
    })

    return {
      id: record.id,
      name: record.rootPath.split('/').filter(Boolean).pop() ?? record.rootPath,
      rootPath: record.rootPath,
      packageManager: null,
      defaultBranch: null,
      config: null,
      configPath: null,
      addedAt: record.addedAt,
      setup: { portMode: 'none', headline: 'This path no longer exists.', notes: [] },
      issues,
    }
  }

  const source = record.config ? { state: 'stored' as const } : await loadConfig(record.rootPath)
  const config =
    record.config ??
    (source.state === 'ok' ? source.config : await suggestConfig(record.rootPath))
  const configPath = resolve(record.rootPath, 'ccwt.config.json')

  if (source.state === 'invalid') {
    for (const issue of source.issues.slice(0, 5)) {
      issues.push({
        code: 'project.config-invalid',
        severity: 'error',
        message: `ccwt.config.json — ${issue.path}: ${issue.message}`,
        hint: 'Until this parses, ccwt falls back to what it can detect.',
      })
    }
  }

  if (record.config && (record.configRevision ?? 0) < RECIPE_REVISION) {
    issues.push({
      code: 'project.recipe-stale',
      severity: 'warning',
      message: 'This recipe was saved by an older ccwt and is missing settings it now knows about.',
      hint: 'Open the recipe and press detect to refresh it — your customisations are shown as a diff before anything is saved.',
    })
  }

  if (config.services.length === 0) {
    issues.push({
      code: 'project.no-dev-script',
      severity: 'warning',
      message: 'No dev script found, so worktrees get no service.',
      hint: 'Add a `dev` script, or declare services in ccwt.config.json.',
    })
  }

  const stacks = await findCompose(record.rootPath)

  for (const service of config.services) {
    const stack = stacks.find((candidate) => service.command.includes(candidate.file))

    if (stack && service.ports) {
      const declared = Object.keys(service.ports).sort()
      const actual = portVariables(stack)
        .map((variable) => variable.name)
        .sort()

      const missing = actual.filter((name) => !declared.includes(name))
      const extra = declared.filter((name) => !actual.includes(name))

      if (missing.length || extra.length) {
        issues.push({
          code: 'project.ports-out-of-date',
          severity: 'error',
          message: `\`${service.name}\` allocates ${declared.join(', ') || 'nothing'}, but ${stack.file} reads ${actual.join(', ') || 'nothing'}.`,
          hint: missing.length
            ? `${missing.join(', ')} would fall back to the default in the file, which every worktree shares. Open the recipe and press detect.`
            : 'Open the recipe and press detect to match the file.',
        })
      }
    }

    if (service.ports || service.command.includes('{{port}}')) continue

    issues.push({
      code: 'project.service-ignores-port',
      severity: 'warning',
      message: `\`${service.name}\` runs a command that takes no port, so ccwt cannot place it.`,
      hint: 'Give its command a {{port}} placeholder, or split the script into one service per process.',
    })
  }

  return {
    id: record.id,
    name: await projectName(record.rootPath),
    rootPath: record.rootPath,
    packageManager: await detectPackageManager(record.rootPath),
    defaultBranch: await defaultBranch(record.rootPath),
    config,
    configPath: (await pathExists(configPath)) ? configPath : null,
    addedAt: record.addedAt,
    setup: await describeSetup(record.rootPath, config),
    issues,
  }
}

export async function list(): Promise<Project[]> {
  const records = await listRecords()
  return Promise.all(records.map(hydrate))
}

export async function find(id: string): Promise<Project | null> {
  const record = await findRecord(id)
  return record ? hydrate(record) : null
}

export async function register(rootPath: string): Promise<Project> {
  const root = await repoRoot(rootPath)
  if (!root) {
    throw new Error(`${rootPath} is not inside a git repository.`)
  }

  const record = await addRecord({
    id: idFor(root),
    rootPath: root,
    addedAt: new Date().toISOString(),
  })

  return hydrate(record)
}

export async function forget(id: string): Promise<boolean> {
  return removeRecord(id)
}
