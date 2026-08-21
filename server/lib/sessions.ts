import { db } from './db'

export type SessionRows = Record<string, unknown>

export interface SessionMark {
  at: string
  rows: SessionRows
  title?: string
}

export function asRows(value: unknown): SessionRows | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as SessionRows
}

export async function readMark(sessionId: string): Promise<SessionMark | null> {
  const row = await db()
    .selectFrom('sessions')
    .selectAll()
    .where('session_id', '=', sessionId)
    .executeTakeFirst()

  if (!row) return null

  let rows: SessionRows = {}
  try {
    rows = asRows(JSON.parse(row.snapshot) as unknown) ?? {}
  } catch {
    rows = {}
  }

  return { at: row.at, rows, title: row.title ?? undefined }
}

export async function writeMark(
  sessionId: string,
  rows: SessionRows,
  title: string | undefined,
): Promise<void> {
  const values = {
    session_id: sessionId,
    title: title ?? null,
    snapshot: JSON.stringify(rows),
    at: new Date().toISOString(),
  }

  await db()
    .insertInto('sessions')
    .values(values)
    .onConflict((clash) => clash.column('session_id').doUpdateSet(values))
    .execute()
}

export async function forgetMark(sessionId: string): Promise<void> {
  await db().deleteFrom('sessions').where('session_id', '=', sessionId).execute()
}
