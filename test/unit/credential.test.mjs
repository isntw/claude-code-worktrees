import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dropHome, makeHome } from '../helpers/home.mjs'
import { importLib } from '../helpers/tslib.mjs'

const { close, db } = await importLib('db')

const SAVED = {
  id: 1,
  token: 'gho_one',
  login: 'isntw',
  scopes: JSON.stringify(['repo']),
  saved_at: '2026-01-01T00:00:00.000Z',
  refresh_token: null,
  expires_at: null,
}

async function withStore(work) {
  const home = makeHome()
  const previous = process.env.CCWT_HOME
  process.env.CCWT_HOME = home

  try {
    return await work()
  } finally {
    await close()
    if (previous === undefined) delete process.env.CCWT_HOME
    else process.env.CCWT_HOME = previous
    dropHome(home)
  }
}

const put = (values) =>
  db()
    .insertInto('credentials')
    .values(values)
    .onConflict((clash) => clash.column('id').doUpdateSet(values))
    .execute()

test('a signed-in account is stored as exactly one row', async () => {
  await withStore(async () => {
    await put(SAVED)
    await put({ ...SAVED, token: 'gho_two', login: 'other' })

    const rows = await db().selectFrom('credentials').selectAll().execute()

    assert.equal(rows.length, 1, 'signing in again must replace, never accumulate')
    assert.equal(rows[0].token, 'gho_two')
    assert.equal(rows[0].login, 'other')
  })
})

test('a refreshed token replaces the old one in place', async () => {
  await withStore(async () => {
    await put(SAVED)
    await put({
      ...SAVED,
      token: 'gho_refreshed',
      refresh_token: 'ghr_next',
      expires_at: '2026-12-31T00:00:00.000Z',
    })

    const row = await db().selectFrom('credentials').selectAll().executeTakeFirst()

    assert.equal(row.token, 'gho_refreshed')
    assert.equal(row.refresh_token, 'ghr_next')
    assert.equal(row.expires_at, '2026-12-31T00:00:00.000Z')
  })
})

test('scopes survive as a list rather than a string', async () => {
  await withStore(async () => {
    await put({ ...SAVED, scopes: JSON.stringify(['repo', 'read:org']) })

    const row = await db().selectFrom('credentials').selectAll().executeTakeFirst()

    assert.deepEqual(JSON.parse(row.scopes), ['repo', 'read:org'])
  })
})

test('signing out leaves nothing behind', async () => {
  await withStore(async () => {
    await put(SAVED)
    await db().deleteFrom('credentials').where('id', '=', 1).execute()

    assert.deepEqual(await db().selectFrom('credentials').selectAll().execute(), [])
  })
})

test('a credential row cannot exist without a token', async () => {
  await withStore(async () => {
    await assert.rejects(
      () => db().insertInto('credentials').values({ ...SAVED, token: null }).execute(),
      /NOT NULL constraint failed: credentials.token/,
    )
  })
})
