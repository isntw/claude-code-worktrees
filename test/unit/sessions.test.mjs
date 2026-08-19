import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dropHome, makeHome } from '../helpers/home.mjs'
import { importLib } from '../helpers/tslib.mjs'

const sessions = await importLib('sessions')
const { close } = await importLib('db')

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

test('a session ccwt has not seen has no mark', async () => {
  await withStore(async () => {
    assert.equal(await sessions.readMark('never-seen'), null)
  })
})

test('a mark round trips with its snapshot and the title ccwt set', async () => {
  await withStore(async () => {
    const rows = [{ worktree: 'alpha', service: 'dev', port: 5276 }]
    await sessions.writeMark('sess-1', rows, 'alpha')

    const held = await sessions.readMark('sess-1')

    assert.deepEqual(held.rows, rows)
    assert.equal(held.title, 'alpha')
    assert.match(held.at, /^\d{4}-\d{2}-\d{2}T/)
  })
})

test('writing the same session again replaces the mark rather than failing', async () => {
  await withStore(async () => {
    await sessions.writeMark('sess-1', [{ port: 1 }], 'first')
    await sessions.writeMark('sess-1', [{ port: 2 }], 'second')

    const held = await sessions.readMark('sess-1')

    assert.deepEqual(held.rows, [{ port: 2 }])
    assert.equal(held.title, 'second')
  })
})

test('a mark with no title is stored, so ccwt can tell "no name set" from "name set"', async () => {
  await withStore(async () => {
    await sessions.writeMark('sess-1', [], undefined)

    const held = await sessions.readMark('sess-1')

    assert.equal(held.title, undefined)
    assert.deepEqual(held.rows, [])
  })
})

test('sessions do not read each other', async () => {
  await withStore(async () => {
    await sessions.writeMark('sess-1', [{ port: 1 }], 'one')
    await sessions.writeMark('sess-2', [{ port: 2 }], 'two')

    assert.equal((await sessions.readMark('sess-1')).title, 'one')
    assert.equal((await sessions.readMark('sess-2')).title, 'two')
  })
})

test('a session that ends is forgotten', async () => {
  await withStore(async () => {
    await sessions.writeMark('sess-1', [{ port: 1 }], 'one')
    await sessions.forgetMark('sess-1')

    assert.equal(await sessions.readMark('sess-1'), null)
  })
})

test('forgetting a session that was never marked is not an error', async () => {
  await withStore(async () => {
    await sessions.forgetMark('never-seen')
  })
})
