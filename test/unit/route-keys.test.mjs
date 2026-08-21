import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dropHome, makeHome } from '../helpers/home.mjs'
import { importLib, importShared } from '../helpers/tslib.mjs'

const { resolveKey, routeKeys, slugify } = await importShared('route-keys')
const projects = await importLib('projects')
const store = await importLib('store')
const { close } = await importLib('db')

test('a name becomes a key a URL can carry', () => {
  assert.equal(slugify('claude-code-worktrees'), 'claude-code-worktrees')
  assert.equal(slugify('kp_clp_portal'), 'kp-clp-portal')
  assert.equal(slugify('  Feature/Login  '), 'feature-login')
  assert.equal(slugify('@scope/thing'), 'scope-thing')
  assert.equal(slugify('...'), '')
})

test('a name that identifies one thing becomes the key', () => {
  const keys = routeKeys([
    { id: 'aaaaaaaaaaaa', name: 'ccwt' },
    { id: 'bbbbbbbbbbbb', name: 'Anime Downloader' },
  ])

  assert.equal(keys.get('aaaaaaaaaaaa'), 'ccwt')
  assert.equal(keys.get('bbbbbbbbbbbb'), 'anime-downloader')
})

test('a shared name identifies neither, so both keep their id', () => {
  const keys = routeKeys([
    { id: 'aaaaaaaaaaaa', name: 'api' },
    { id: 'bbbbbbbbbbbb', name: 'API' },
    { id: 'cccccccccccc', name: 'web' },
  ])

  assert.equal(keys.get('aaaaaaaaaaaa'), 'aaaaaaaaaaaa')
  assert.equal(keys.get('bbbbbbbbbbbb'), 'bbbbbbbbbbbb')
  assert.equal(keys.get('cccccccccccc'), 'web')
})

test('a name with nothing usable in it keeps the id', () => {
  const keys = routeKeys([{ id: 'aaaaaaaaaaaa', name: '···' }])

  assert.equal(keys.get('aaaaaaaaaaaa'), 'aaaaaaaaaaaa')
})

test('a name that reads as another thing id keeps the id', () => {
  const keys = routeKeys([
    { id: '8d76229f0bc2', name: 'manager' },
    { id: 'bbbbbbbbbbbb', name: '8d76229f0bc2' },
  ])

  assert.equal(keys.get('bbbbbbbbbbbb'), 'bbbbbbbbbbbb')
})

test('an id and a key both resolve, and anything else does not', () => {
  const items = [
    { id: 'aaaaaaaaaaaa', name: 'ccwt' },
    { id: 'bbbbbbbbbbbb', name: 'api' },
    { id: 'cccccccccccc', name: 'API' },
  ]

  assert.equal(resolveKey(items, 'aaaaaaaaaaaa'), 'aaaaaaaaaaaa')
  assert.equal(resolveKey(items, 'ccwt'), 'aaaaaaaaaaaa')
  assert.equal(resolveKey(items, 'api'), null)
  assert.equal(resolveKey(items, 'bbbbbbbbbbbb'), 'bbbbbbbbbbbb')
  assert.equal(resolveKey(items, 'nothing'), null)
})

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

test('a project answers to its name as well as its id', async () => {
  await withStore(async () => {
    await store.addRecord({
      id: 'aaaaaaaaaaaa',
      rootPath: '/repo/anime downloader',
      addedAt: '2026-01-01T00:00:00.000Z',
    })

    const byKey = await projects.find('anime-downloader')
    const byId = await projects.find('aaaaaaaaaaaa')

    assert.equal(byKey?.id, 'aaaaaaaaaaaa')
    assert.equal(byId?.id, 'aaaaaaaaaaaa')
    assert.equal(await projects.find('something-else'), null)
  })
})

test('a name two projects share resolves to neither, only their ids do', async () => {
  await withStore(async () => {
    await store.addRecord({
      id: 'aaaaaaaaaaaa',
      rootPath: '/one/api',
      addedAt: '2026-01-01T00:00:00.000Z',
    })
    await store.addRecord({
      id: 'bbbbbbbbbbbb',
      rootPath: '/two/api',
      addedAt: '2026-01-02T00:00:00.000Z',
    })

    assert.equal(await projects.find('api'), null)
    assert.equal((await projects.find('aaaaaaaaaaaa'))?.rootPath, '/one/api')
    assert.equal((await projects.find('bbbbbbbbbbbb'))?.rootPath, '/two/api')
  })
})
