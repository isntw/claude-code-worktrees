import type { DatabaseSync } from 'node:sqlite'

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL UNIQUE,
  added_at TEXT NOT NULL,
  recipe TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL,
  login TEXT,
  scopes TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  title TEXT,
  snapshot TEXT NOT NULL,
  at TEXT NOT NULL
) STRICT;
`

export interface MetaTable {
  key: string
  value: string
}

export interface ProjectTable {
  id: string
  root_path: string
  added_at: string
  recipe: string | null
}

export interface CredentialTable {
  id: number
  token: string
  login: string | null
  scopes: string
  saved_at: string
  refresh_token: string | null
  expires_at: string | null
}

export interface SessionTable {
  session_id: string
  title: string | null
  snapshot: string
  at: string
}

export interface Database {
  meta: MetaTable
  projects: ProjectTable
  credentials: CredentialTable
  sessions: SessionTable
}

function reshapeLegacyColumns(open: DatabaseSync): void {
  const columns = open.prepare('PRAGMA table_info(projects)').all() as unknown as { name: string }[]
  const has = (name: string) => columns.some((column) => column.name === name)

  if (has('config') && !has('recipe')) {
    open.exec('ALTER TABLE projects RENAME COLUMN config TO recipe')
  }

  if (has('config_revision')) {
    open.exec('ALTER TABLE projects DROP COLUMN config_revision')
  }

  if (has('recipe_revision')) {
    open.exec('ALTER TABLE projects DROP COLUMN recipe_revision')
  }
}

export function apply(open: DatabaseSync): void {
  open.exec('PRAGMA journal_mode = WAL')
  open.exec('PRAGMA busy_timeout = 5000')
  open.exec('PRAGMA synchronous = NORMAL')
  open.exec('PRAGMA foreign_keys = ON')
  open.exec(SCHEMA)
  reshapeLegacyColumns(open)
}
