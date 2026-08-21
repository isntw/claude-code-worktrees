import { join } from 'node:path'
import type { Diagnostic, Project } from '../../shared/types'
import { defaultBranch, idFor, repoRoot } from './git'
import { pathExists, readJsonSafe } from './fs'
import { parseRecipe } from '../../shared/recipe-schema'
import { resolveKey } from '../../shared/route-keys'
import { describeSetup } from './setup'
import { addRecord, findRecord, listRecords, removeRecord } from './store'
import type { ProjectRecord } from './store'

function nameOf(rootPath: string): string {
  return rootPath.split('/').filter(Boolean).pop() ?? rootPath
}

export async function projectName(rootPath: string): Promise<string> {
  const manifest = await readJsonSafe<{ name?: string }>(join(rootPath, 'package.json'))
  const declared = manifest?.name?.split('/').pop()
  return declared || nameOf(rootPath)
}

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
      name: nameOf(record.rootPath),
      rootPath: record.rootPath,
      defaultBranch: null,
      recipe: null,
      addedAt: record.addedAt,
      setup: { portMode: 'none', headline: 'This path no longer exists.', notes: [] },
      issues,
    }
  }

  const stored = record.recipe ? parseRecipe(record.recipe) : null
  const recipe = stored?.ok ? stored.recipe : null

  if (stored && !stored.ok) {
    for (const issue of stored.issues.slice(0, 5)) {
      issues.push({
        code: 'project.recipe-invalid',
        severity: 'error',
        message: `The saved recipe no longer validates — ${issue.path}: ${issue.message}`,
        hint: 'Fix it on the recipe page, or forget it and write another.',
      })
    }
  }

  if (!recipe) {
    issues.push({
      code: 'project.no-recipe',
      severity: 'error',
      message: 'This project has no recipe, so ccwt cannot make a worktree for it.',
      hint: 'Write one on the recipe page, or ask Claude to.',
    })
  }

  for (const service of recipe?.services ?? []) {
    if (service.command.includes('{{port}}')) continue
    if (Object.values(service.env ?? {}).some((value) => value.includes('{{port}}'))) continue
    if (service.portRange[0] === service.portRange[1]) continue

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
    defaultBranch: await defaultBranch(record.rootPath),
    recipe,
    addedAt: record.addedAt,
    setup: await describeSetup(record.rootPath, recipe),
    issues,
  }
}

export async function list(): Promise<Project[]> {
  const records = await listRecords()
  return Promise.all(records.map(hydrate))
}

export async function find(key: string): Promise<Project | null> {
  const direct = await findRecord(key)
  if (direct) return hydrate(direct)

  const records = await listRecords()
  const named = await Promise.all(
    records.map(async (record) => ({ id: record.id, name: await projectName(record.rootPath) })),
  )

  const id = resolveKey(named, key)
  const record = id ? records.find((candidate) => candidate.id === id) : undefined

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
