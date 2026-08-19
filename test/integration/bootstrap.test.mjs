import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { LEGACY_PROJECTS, withHome } from '../helpers/home.mjs'
import { NO_BUILD, built, withServer } from '../helpers/server.mjs'
import { ask, reachServer, tell } from '../../plugin/lib/discover.mjs'

const skip = built() ? false : NO_BUILD

const runtime = (home, values) =>
  writeFileSync(join(home, 'runtime.json'), JSON.stringify(values))

test('with no runtime.json the plugin finds no server', async () => {
  await withHome(async () => {
    assert.equal(await reachServer(), null)
  })
})

test('a runtime.json whose port answers yields the origin and token', async () => {
  const held = createServer()
  await new Promise((done) => held.listen(0, '127.0.0.1', done))
  const { port } = held.address()

  try {
    await withHome(async (home) => {
      runtime(home, { host: '127.0.0.1', port, pid: process.pid, token: 'abc123' })

      assert.deepEqual(await reachServer(), {
        origin: `http://127.0.0.1:${port}`,
        token: 'abc123',
      })
    })
  } finally {
    held.close()
  }
})

test('an IPv6 host is bracketed, so the URL is usable', async () => {
  const held = createServer()
  await new Promise((done) => held.listen(0, '127.0.0.1', done))
  const { port } = held.address()

  try {
    await withHome(async (home) => {
      runtime(home, { host: '::1', port, pid: process.pid, token: 'abc123' })

      assert.equal((await reachServer()).origin, `http://[::1]:${port}`)
    })
  } finally {
    held.close()
  }
})

test('a stale runtime.json whose port is dead yields nothing', async () => {
  const held = createServer()
  await new Promise((done) => held.listen(0, '127.0.0.1', done))
  const { port } = held.address()
  await new Promise((done) => held.close(done))

  await withHome(async (home) => {
    runtime(home, { host: '127.0.0.1', port, pid: process.pid, token: 'abc123' })
    assert.equal(await reachServer(), null)
  })
})

test('a runtime.json with no token is refused, so nothing calls the API unauthenticated', async () => {
  const held = createServer()
  await new Promise((done) => held.listen(0, '127.0.0.1', done))
  const { port } = held.address()

  try {
    await withHome(async (home) => {
      runtime(home, { host: '127.0.0.1', port })
      assert.equal(await reachServer(), null)
    })
  } finally {
    held.close()
  }
})

test('with ccwt closed every plugin call is null rather than an error', async () => {
  await withHome(async () => {
    assert.equal(await ask('/api/plugin/state'), null)
    assert.equal(await tell('/api/plugin/session/x', { rows: [] }), null)
  })
})

test('the plugin reads projects and writes a session mark through the API', { skip }, async () => {
  await withServer(async ({ home, port, token }) => {
    const previous = process.env.CCWT_HOME
    process.env.CCWT_HOME = home
    runtime(home, { host: '127.0.0.1', port, pid: process.pid, token })

    try {
      const state = await ask('/api/plugin/state')
      assert.equal(state.projects.length, 2)

      assert.equal(await tell('/api/plugin/session/sess-x', { rows: [{ port: 1 }], title: 'x' }), true)
      assert.equal((await ask('/api/plugin/session/sess-x')).title, 'x')
    } finally {
      if (previous === undefined) delete process.env.CCWT_HOME
      else process.env.CCWT_HOME = previous
    }
  }, (home) => writeFileSync(join(home, 'state.json'), JSON.stringify(LEGACY_PROJECTS)))
})
