import { resolve } from 'node:path'
import type { Diagnostic, Project } from '../../shared/types'
import { detectDevScript, detectPackageManager, projectName, resolveConfig } from './detect'
import { defaultBranch, idFor, repoRoot } from './git'
import { pathExists } from './fs'
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
      issues,
    }
  }

  const config = await resolveConfig(record.rootPath)
  const configPath = resolve(record.rootPath, 'ccwt.config.json')
  const declared = await pathExists(configPath)

  if (config.services.length === 0) {
    issues.push({
      code: 'project.no-dev-script',
      severity: 'warning',
      message: 'No dev script found, so worktrees get no service.',
      hint: 'Add a `dev` script, or declare services in ccwt.config.json.',
    })
  }

  if (!declared) {
    const script = await detectDevScript(record.rootPath)
    if (script?.multiProcess) {
      issues.push({
        code: 'project.multi-process-dev-script',
        severity: 'warning',
        message: `\`${script.name}\` starts more than one process, so ccwt cannot tell it which port to use.`,
        hint: 'Declare one service per process in ccwt.config.json, each with its own {{port}}.',
      })
    }
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
