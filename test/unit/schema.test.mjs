import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { sourceOf } from '../helpers/tslib.mjs'

const source = sourceOf('server/lib/schema.ts')
const ddl = source.slice(source.indexOf('`') + 1, source.indexOf('`', source.indexOf('`') + 1))

const TYPES = {
  MetaTable: 'meta',
  ProjectTable: 'projects',
  CredentialTable: 'credentials',
  SessionTable: 'sessions',
}

function withDatabase(work) {
  const dir = mkdtempSync(join(tmpdir(), 'ccwt-schema-'))
  const db = new DatabaseSync(join(dir, 'probe.db'))

  try {
    db.exec(ddl)
    return work(db)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

function declaredFields(name) {
  const at = source.indexOf(`export interface ${name} {`)
  assert.ok(at !== -1, `schema.ts should declare ${name}`)
  const body = source.slice(at, source.indexOf('}', at))
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((hit) => hit[1])
}

test('the schema declares exactly the four tables the server owns', () => {
  const found = withDatabase((db) =>
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name),
  )

  assert.deepEqual(found, ['credentials', 'meta', 'projects', 'sessions'])
})

test('each table has exactly the columns its TypeScript type declares', () => {
  withDatabase((db) => {
    for (const [type, table] of Object.entries(TYPES)) {
      const declared = declaredFields(type)
      const actual = db
        .prepare(`SELECT name FROM pragma_table_info('${table}')`)
        .all()
        .map((row) => row.name)

      assert.deepEqual(
        [...actual].sort(),
        [...declared].sort(),
        `${table} and ${type} disagree about columns`,
      )
    }
  })
})

test('every table is STRICT, so a wrong type is an error rather than a coercion', () => {
  const flags = withDatabase((db) =>
    db
      .prepare(
        "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%'",
      )
      .all(),
  )

  for (const row of flags) {
    assert.equal(row.strict, 1, `${row.name} should be STRICT`)
  }
})

test('a repository cannot be registered twice under the same path', () => {
  withDatabase((db) => {
    const insert = db.prepare(
      'INSERT INTO projects (id, root_path, added_at) VALUES (:id, :rootPath, :addedAt)',
    )
    insert.run({ id: 'one', rootPath: '/repo', addedAt: 'now' })

    assert.throws(
      () => insert.run({ id: 'two', rootPath: '/repo', addedAt: 'now' }),
      /UNIQUE constraint failed: projects.root_path/,
    )
  })
})

test('the pragmas the server applies are the ones a concurrent reader needs', () => {
  const applied = sourceOf('server/lib/schema.ts')

  assert.match(applied, /PRAGMA journal_mode = WAL/)
  assert.match(applied, /PRAGMA busy_timeout = \d+/)
  assert.match(applied, /PRAGMA foreign_keys = ON/)
})
