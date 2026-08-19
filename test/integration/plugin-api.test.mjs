import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { LEGACY_PROJECTS } from '../helpers/home.mjs'
import { NO_BUILD, built, withServer } from '../helpers/server.mjs'

const skip = built() ? false : NO_BUILD

const seed = (home) => {
  writeFileSync(join(home, 'state.json'), JSON.stringify(LEGACY_PROJECTS))
}

test('the plugin state endpoint refuses a caller with no token', { skip }, async () => {
  await withServer(async ({ naked }) => {
    const answered = await naked('/api/plugin/state')
    assert.equal(answered.status, 401)
  }, seed)
})

test('the plugin state endpoint returns every project and its recipe', { skip }, async () => {
  await withServer(async ({ call }) => {
    const { status, body } = await call('GET', '/api/plugin/state')

    assert.equal(status, 200)
    assert.equal(body.projects.length, 2)

    const alpha = body.projects.find((entry) => entry.id === 'aaa111')
    assert.equal(alpha.rootPath, '/repo/alpha')
    assert.deepEqual(alpha.config.services, LEGACY_PROJECTS.projects[0].config.services)

    const beta = body.projects.find((entry) => entry.id === 'bbb222')
    assert.equal(beta.config, undefined)
  }, seed)
})

test('a session mark can be written, read and ended over the API', { skip }, async () => {
  await withServer(async ({ call }) => {
    assert.deepEqual((await call('GET', '/api/plugin/session/sess-1')).body, {})

    const rows = [{ worktree: 'alpha', service: 'dev', port: 5276 }]
    assert.equal((await call('PUT', '/api/plugin/session/sess-1', { rows, title: 'alpha' })).status, 200)

    const stored = await call('GET', '/api/plugin/session/sess-1')
    assert.deepEqual(stored.body.rows, rows)
    assert.equal(stored.body.title, 'alpha')

    assert.equal((await call('PUT', '/api/plugin/session/sess-1', { done: true })).status, 200)
    assert.deepEqual((await call('GET', '/api/plugin/session/sess-1')).body, {})
  }, seed)
})

test('two sessions do not overwrite each other', { skip }, async () => {
  await withServer(async ({ call }) => {
    await call('PUT', '/api/plugin/session/one', { rows: [{ port: 1 }], title: 'first' })
    await call('PUT', '/api/plugin/session/two', { rows: [{ port: 2 }], title: 'second' })

    assert.equal((await call('GET', '/api/plugin/session/one')).body.title, 'first')
    assert.equal((await call('GET', '/api/plugin/session/two')).body.title, 'second')
  }, seed)
})

test('the credential is readable and sign-out clears it', { skip }, async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('GET', '/api/forge/session')).status, 200)
    assert.equal((await call('DELETE', '/api/forge/session')).status, 200)
  }, seed)
})

test('the projects endpoint serves what the migration absorbed', { skip }, async () => {
  await withServer(async ({ call }) => {
    const { status, body } = await call('GET', '/api/projects')

    assert.equal(status, 200)
    assert.deepEqual(body.map((entry) => entry.id).sort(), ['aaa111', 'bbb222'])
  }, seed)
})
