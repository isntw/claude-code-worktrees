import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Kysely } from 'kysely'
import { nodeSqliteDialect } from './dialect'
import { databasePath, stateDir } from './paths'
import { type Database, apply } from './schema'

export { databasePath, stateDir }

let raw: DatabaseSync | null = null
let handle: Kysely<Database> | null = null

function openRaw(): DatabaseSync {
  if (raw) return raw

  const path = databasePath()
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 })

  raw = new DatabaseSync(path)
  apply(raw)
  chmodSync(path, 0o600)

  adoptLegacy(raw)

  return raw
}

export function db(): Kysely<Database> {
  handle ??= new Kysely<Database>({ dialect: nodeSqliteDialect(openRaw) })
  return handle
}

export async function close(): Promise<void> {
  const held = handle
  handle = null
  raw = null
  await held?.destroy()
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function discard(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    return
  }
}

interface LegacyRecord {
  id?: unknown
  rootPath?: unknown
  addedAt?: unknown
  config?: unknown
  configRevision?: unknown
}

function adoptLegacy(open: DatabaseSync): void {
  const done = open.prepare('SELECT value FROM meta WHERE key = :key').get({ key: 'adopted' })
  if (done) return

  const retire: string[] = []

  if (adoptProjects(open)) retire.push(join(stateDir(), 'state.json'))
  if (adoptCredential(open)) retire.push(join(stateDir(), 'forge.json'))
  if (adoptSessions(open)) retire.push(join(stateDir(), 'sessions'))

  retire.push(join(stateDir(), 'token'), join(stateDir(), 'server.json'))

  for (const path of retire) discard(path)

  open
    .prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (:key, :value)')
    .run({ key: 'adopted', value: new Date().toISOString() })
}

function adoptProjects(open: DatabaseSync): boolean {
  const path = join(stateDir(), 'state.json')
  const parsed = readJson(path) as { projects?: unknown } | null
  if (!parsed || !Array.isArray(parsed.projects)) return false

  const wanted = (parsed.projects as LegacyRecord[]).filter(
    (entry) => typeof entry?.id === 'string' && typeof entry.rootPath === 'string',
  )

  const insert = open.prepare(
    `INSERT OR IGNORE INTO projects (id, root_path, added_at, config, config_revision)
     VALUES (:id, :rootPath, :addedAt, :config, :revision)`,
  )

  for (const entry of wanted) {
    insert.run({
      id: entry.id as string,
      rootPath: entry.rootPath as string,
      addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : new Date(0).toISOString(),
      config: entry.config === undefined ? null : JSON.stringify(entry.config),
      revision: typeof entry.configRevision === 'number' ? entry.configRevision : null,
    })
  }

  const landed = open.prepare('SELECT count(*) AS n FROM projects').get() as unknown as { n: number }
  if (landed.n < wanted.length) {
    throw new Error(
      `Refusing to remove ${path}: it lists ${wanted.length} projects but only ${landed.n} reached the database.`,
    )
  }

  return true
}

function adoptCredential(open: DatabaseSync): boolean {
  const path = join(stateDir(), 'forge.json')
  const saved = readJson(path) as Record<string, unknown> | null
  if (!saved || typeof saved.token !== 'string') return false

  open
    .prepare(
      `INSERT OR REPLACE INTO credentials (id, token, login, scopes, saved_at, refresh_token, expires_at)
       VALUES (1, :token, :login, :scopes, :savedAt, :refreshToken, :expiresAt)`,
    )
    .run({
      token: saved.token,
      login: typeof saved.login === 'string' ? saved.login : null,
      scopes: JSON.stringify(Array.isArray(saved.scopes) ? saved.scopes : []),
      savedAt: typeof saved.savedAt === 'string' ? saved.savedAt : new Date().toISOString(),
      refreshToken: typeof saved.refreshToken === 'string' ? saved.refreshToken : null,
      expiresAt: typeof saved.expiresAt === 'string' ? saved.expiresAt : null,
    })

  return true
}

function adoptSessions(open: DatabaseSync): boolean {
  const dir = join(stateDir(), 'sessions')

  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return false
  }

  const insert = open.prepare(
    `INSERT OR IGNORE INTO sessions (session_id, title, snapshot, at)
     VALUES (:id, :title, :snapshot, :at)`,
  )

  for (const name of names) {
    if (!name.endsWith('.json')) continue

    const held = readJson(join(dir, name)) as { at?: unknown; rows?: unknown; title?: unknown } | null
    if (!held) continue

    insert.run({
      id: name.slice(0, -'.json'.length),
      title: typeof held.title === 'string' ? held.title : null,
      snapshot: JSON.stringify(Array.isArray(held.rows) ? held.rows : []),
      at: typeof held.at === 'string' ? held.at : new Date().toISOString(),
    })
  }

  return true
}
