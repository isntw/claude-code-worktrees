import type { Recipe } from '../../shared/types'
import { databasePath, db, stateDir } from './db'
import type { ProjectTable } from './schema'

export { databasePath, stateDir }

export interface ProjectRecord {
  id: string
  rootPath: string
  addedAt: string
  recipe?: Recipe
}

function toRecord(row: ProjectTable): ProjectRecord {
  const record: ProjectRecord = {
    id: row.id,
    rootPath: row.root_path,
    addedAt: row.added_at,
  }

  if (row.recipe !== null) {
    try {
      record.recipe = JSON.parse(row.recipe) as Recipe
    } catch {
      record.recipe = undefined
    }
  }

  return record
}

export async function listRecords(): Promise<ProjectRecord[]> {
  const rows = await db()
    .selectFrom('projects')
    .selectAll()
    .orderBy('added_at')
    .orderBy('id')
    .execute()

  return rows.map(toRecord)
}

export async function findRecord(id: string): Promise<ProjectRecord | null> {
  const row = await db()
    .selectFrom('projects')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()

  return row ? toRecord(row) : null
}

export async function addRecord(record: ProjectRecord): Promise<ProjectRecord> {
  const existing = await findRecord(record.id)
  if (existing) return existing

  await db()
    .insertInto('projects')
    .values({
      id: record.id,
      root_path: record.rootPath,
      added_at: record.addedAt,
      recipe: record.recipe === undefined ? null : JSON.stringify(record.recipe),
    })
    .execute()

  return record
}

export async function updateRecord(
  id: string,
  change: Partial<Omit<ProjectRecord, 'id'>>,
): Promise<ProjectRecord | null> {
  const record = await findRecord(id)
  if (!record) return null

  const patch: Partial<ProjectTable> = {}

  if ('rootPath' in change && change.rootPath !== undefined) patch.root_path = change.rootPath
  if ('addedAt' in change && change.addedAt !== undefined) patch.added_at = change.addedAt
  if ('recipe' in change) {
    patch.recipe = change.recipe === undefined ? null : JSON.stringify(change.recipe)
  }
  if (Object.keys(patch).length) {
    await db().updateTable('projects').set(patch).where('id', '=', id).execute()
  }

  return findRecord(id)
}

export async function removeRecord(id: string): Promise<boolean> {
  const result = await db().deleteFrom('projects').where('id', '=', id).executeTakeFirst()
  return Number(result.numDeletedRows ?? 0) > 0
}
