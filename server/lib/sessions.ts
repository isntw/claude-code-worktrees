import { db } from './db'

export interface SessionMark {
  at: string
  rows: unknown[]
  title?: string
}

export async function readMark(sessionId: string): Promise<SessionMark | null> {
  const row = await db()
    .selectFrom('sessions')
    .selectAll()
    .where('session_id', '=', sessionId)
    .executeTakeFirst()

  if (!row) return null

  let rows: unknown[] = []
  try {
    const parsed = JSON.parse(row.snapshot) as unknown
    if (Array.isArray(parsed)) rows = parsed
  } catch {
    rows = []
  }

  return { at: row.at, rows, title: row.title ?? undefined }
}

export async function writeMark(
  sessionId: string,
  rows: unknown[],
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
