import assert from 'node:assert/strict'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  LEGACY_CREDENTIAL,
  LEGACY_PROJECTS,
  LEGACY_SESSION,
  dropHome,
  makeHome,
} from '../helpers/home.mjs'
import { importLib } from '../helpers/tslib.mjs'

const { close, db } = await importLib('db')

function seed(home, { projects = true, credential = true, sessions = true, loose = true } = {}) {
  if (projects) writeFileSync(join(home, 'state.json'), JSON.stringify(LEGACY_PROJECTS))
  if (credential) writeFileSync(join(home, 'forge.json'), JSON.stringify(LEGACY_CREDENTIAL))
  if (sessions) {
    mkdirSync(join(home, 'sessions'), { recursive: true })
    writeFileSync(join(home, 'sessions', 'sess-1.json'), JSON.stringify(LEGACY_SESSION))
  }
  if (loose) {
    writeFileSync(join(home, 'token'), 'deadbeef')
    writeFileSync(join(home, 'server.json'), JSON.stringify({ host: '127.0.0.1', port: 4600 }))
  }
}

async function withHome(options, work) {
  const home = makeHome()
  const previous = process.env.CCWT_HOME
  process.env.CCWT_HOME = home
  seed(home, options)

  try {
    return await work(home)
  } finally {
    await close()
    if (previous === undefined) delete process.env.CCWT_HOME
    else process.env.CCWT_HOME = previous
    dropHome(home)
  }
}

test('every registered repository and its recipe crosses into the database', async () => {
  await withHome({}, async () => {
    const rows = await db().selectFrom('projects').selectAll().orderBy('id').execute()

    assert.equal(rows.length, 2)
    assert.equal(rows[0].id, 'aaa111')
    assert.equal(rows[0].root_path, '/repo/alpha')
    assert.equal(rows[0].config_revision, 3)
    assert.deepEqual(JSON.parse(rows[0].config), LEGACY_PROJECTS.projects[0].config)

    assert.equal(rows[1].id, 'bbb222')
    assert.equal(rows[1].config, null)
    assert.equal(rows[1].config_revision, null)
  })
})

test('the GitHub credential crosses over intact', async () => {
  await withHome({}, async () => {
    const row = await db().selectFrom('credentials').selectAll().executeTakeFirst()

    assert.equal(row.token, LEGACY_CREDENTIAL.token)
    assert.equal(row.login, 'isntw')
    assert.deepEqual(JSON.parse(row.scopes), ['repo'])
  })
})

test('session marks cross over keyed by session id', async () => {
  await withHome({}, async () => {
    const row = await db().selectFrom('sessions').selectAll().executeTakeFirst()

    assert.equal(row.session_id, 'sess-1')
    assert.equal(row.title, 'alpha')
    assert.deepEqual(JSON.parse(row.snapshot), LEGACY_SESSION.rows)
  })
})

test('the files it replaced are gone afterwards', async () => {
  await withHome({}, async (home) => {
    await db().selectFrom('projects').selectAll().execute()

    for (const name of ['state.json', 'forge.json', 'token', 'server.json', 'sessions']) {
      assert.ok(!existsSync(join(home, name)), `${name} should have been removed`)
    }
  })
})

test('migrating happens once, so a later run does not resurrect deleted repositories', async () => {
  await withHome({}, async (home) => {
    await db().deleteFrom('projects').where('id', '=', 'aaa111').execute()
    await close()

    writeFileSync(join(home, 'state.json'), JSON.stringify(LEGACY_PROJECTS))

    const rows = await db().selectFrom('projects').selectAll().execute()

    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, 'bbb222')
    assert.ok(existsSync(join(home, 'state.json')), 'a file written after migration is left alone')
  })
})

test('a first run with nothing to migrate still produces a usable database', async () => {
  await withHome({ projects: false, credential: false, sessions: false, loose: false }, async () => {
    assert.deepEqual(await db().selectFrom('projects').selectAll().execute(), [])
    assert.deepEqual(await db().selectFrom('credentials').selectAll().execute(), [])
  })
})

test('a corrupt state.json is kept, not silently discarded', async () => {
  const home = makeHome()
  const previous = process.env.CCWT_HOME
  process.env.CCWT_HOME = home
  writeFileSync(join(home, 'state.json'), '{ this is not json')

  try {
    await db().selectFrom('projects').selectAll().execute()
    assert.ok(existsSync(join(home, 'state.json')))
  } finally {
    await close()
    if (previous === undefined) delete process.env.CCWT_HOME
    else process.env.CCWT_HOME = previous
    dropHome(home)
  }
})

test('entries without an id or a path are skipped rather than aborting the migration', async () => {
  const home = makeHome()
  const previous = process.env.CCWT_HOME
  process.env.CCWT_HOME = home
  writeFileSync(
    join(home, 'state.json'),
    JSON.stringify({
      version: 1,
      projects: [
        { rootPath: '/repo/no-id' },
        { id: 'good', rootPath: '/repo/good', addedAt: 'now' },
        { id: 'no-path' },
      ],
    }),
  )

  try {
    const rows = await db().selectFrom('projects').selectAll().execute()
    assert.deepEqual(rows.map((row) => row.id), ['good'])
  } finally {
    await close()
    if (previous === undefined) delete process.env.CCWT_HOME
    else process.env.CCWT_HOME = previous
    dropHome(home)
  }
})

test('the database is created private to the user', async () => {
  await withHome(
    { projects: false, credential: false, sessions: false, loose: false },
    async (home) => {
      await db().selectFrom('projects').selectAll().execute()

      const mode = statSync(join(home, 'ccwt.db')).mode & 0o777

      assert.equal(mode, 0o600, `database mode was ${mode.toString(8)}`)
    },
  )
})
