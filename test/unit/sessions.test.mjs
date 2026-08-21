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
    const rows = { 'alpha/dev': { port: 5276, up: true } }
    await sessions.writeMark('sess-1', rows, 'alpha')

    const held = await sessions.readMark('sess-1')

    assert.deepEqual(held.rows, rows)
    assert.equal(held.title, 'alpha')
    assert.match(held.at, /^\d{4}-\d{2}-\d{2}T/)
  })
})

test('writing the same session again replaces the mark rather than failing', async () => {
  await withStore(async () => {
    await sessions.writeMark('sess-1', { 'a/dev': { port: 1, up: false } }, 'first')
    await sessions.writeMark('sess-1', { 'a/dev': { port: 2, up: true } }, 'second')

    const held = await sessions.readMark('sess-1')

    assert.deepEqual(held.rows, { 'a/dev': { port: 2, up: true } })
    assert.equal(held.title, 'second')
  })
})

test('a mark with no title is stored, so ccwt can tell "no name set" from "name set"', async () => {
  await withStore(async () => {
    await sessions.writeMark('sess-1', {}, undefined)

    const held = await sessions.readMark('sess-1')

    assert.equal(held.title, undefined)
    assert.deepEqual(held.rows, {})
  })
})

test('a snapshot left behind as an array reads back empty rather than as rows', async () => {
  await withStore(async () => {
    await sessions.writeMark('sess-1', [], 'ccwt · demo/feature')

    const held = await sessions.readMark('sess-1')

    assert.deepEqual(held.rows, {})
    assert.equal(held.title, 'ccwt · demo/feature')
  })
})

test('sessions do not read each other', async () => {
  await withStore(async () => {
    await sessions.writeMark('sess-1', { 'a/dev': { port: 1, up: false } }, 'one')
    await sessions.writeMark('sess-2', { 'b/dev': { port: 2, up: false } }, 'two')

    assert.equal((await sessions.readMark('sess-1')).title, 'one')
    assert.equal((await sessions.readMark('sess-2')).title, 'two')
  })
})

test('a session that ends is forgotten', async () => {
  await withStore(async () => {
    await sessions.writeMark('sess-1', { 'a/dev': { port: 1, up: false } }, 'one')
    await sessions.forgetMark('sess-1')

    assert.equal(await sessions.readMark('sess-1'), null)
  })
})

test('forgetting a session that was never marked is not an error', async () => {
  await withStore(async () => {
    await sessions.forgetMark('never-seen')
  })
})
