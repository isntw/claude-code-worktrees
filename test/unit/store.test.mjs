import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dropHome, makeHome } from '../helpers/home.mjs'
import { importLib } from '../helpers/tslib.mjs'

const store = await importLib('store')
const { close } = await importLib('db')

const RECIPE = {
  worktreesDir: '.claude/worktrees',
  provision: { copy: [], link: ['node_modules'], write: [], postCreate: [], postRemove: [] },
  services: [{ name: 'dev', cwd: '.', command: 'npm run dev', portRange: [5200, 5299] }],
  claude: { ownWorktreeCreation: false },
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

test('a registered repository comes back with everything it was given', async () => {
  await withStore(async () => {
    await store.addRecord({ id: 'one', rootPath: '/repo/one', addedAt: '2026-01-01T00:00:00.000Z' })

    const found = await store.findRecord('one')

    assert.deepEqual(found, {
      id: 'one',
      rootPath: '/repo/one',
      addedAt: '2026-01-01T00:00:00.000Z',
    })
  })
})

test('registering the same id twice keeps the first and does not throw', async () => {
  await withStore(async () => {
    await store.addRecord({ id: 'one', rootPath: '/repo/one', addedAt: '2026-01-01T00:00:00.000Z' })
    const again = await store.addRecord({
      id: 'one',
      rootPath: '/repo/somewhere-else',
      addedAt: '2026-06-06T00:00:00.000Z',
    })

    assert.equal(again.rootPath, '/repo/one')
    assert.equal((await store.listRecords()).length, 1)
  })
})

test('a recipe survives the round trip through the database', async () => {
  await withStore(async () => {
    await store.addRecord({ id: 'one', rootPath: '/repo/one', addedAt: 'now' })
    await store.updateRecord('one', { recipe: RECIPE })

    const found = await store.findRecord('one')

    assert.deepEqual(found.recipe, RECIPE)
  })
})

test('clearing a recipe is distinguishable from never having one', async () => {
  await withStore(async () => {
    await store.addRecord({ id: 'one', rootPath: '/repo/one', addedAt: 'now' })
    await store.updateRecord('one', { recipe: RECIPE })
    await store.updateRecord('one', { recipe: undefined })

    const found = await store.findRecord('one')

    assert.equal(found.recipe, undefined)
  })
})

test('an update touching one field leaves the others alone', async () => {
  await withStore(async () => {
    await store.addRecord({ id: 'one', rootPath: '/repo/one', addedAt: 'first' })
    await store.updateRecord('one', { recipe: RECIPE })

    const found = await store.findRecord('one')

    assert.equal(found.rootPath, '/repo/one')
    assert.equal(found.addedAt, 'first')
    assert.deepEqual(found.recipe, RECIPE)
  })
})

test('updating a repository that is not registered reports so rather than creating one', async () => {
  await withStore(async () => {
    assert.equal(await store.updateRecord('ghost', { recipe: RECIPE }), null)
    assert.equal((await store.listRecords()).length, 0)
  })
})

test('a corrupt stored recipe reads as absent instead of throwing', async () => {
  await withStore(async () => {
    const { db } = await importLib('db')
    await store.addRecord({ id: 'one', rootPath: '/repo/one', addedAt: 'now' })

    await db()
      .updateTable('projects')
      .set({ recipe: '{not json' })
      .where('id', '=', 'one')
      .execute()

    const found = await store.findRecord('one')

    assert.equal(found.recipe, undefined)
    assert.equal(found.rootPath, '/repo/one')
  })
})

test('repositories are listed oldest first, so the order is stable', async () => {
  await withStore(async () => {
    await store.addRecord({ id: 'b', rootPath: '/repo/b', addedAt: '2026-02-01T00:00:00.000Z' })
    await store.addRecord({ id: 'a', rootPath: '/repo/a', addedAt: '2026-01-01T00:00:00.000Z' })

    assert.deepEqual((await store.listRecords()).map((row) => row.id), ['a', 'b'])
  })
})

test('forgetting a repository reports whether there was one to forget', async () => {
  await withStore(async () => {
    await store.addRecord({ id: 'one', rootPath: '/repo/one', addedAt: 'now' })

    assert.equal(await store.removeRecord('one'), true)
    assert.equal(await store.removeRecord('one'), false)
    assert.equal(await store.findRecord('one'), null)
  })
})
