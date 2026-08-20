import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { decide, hostname } = await importLib('access')

const TOKEN = 'a'.repeat(64)
const HOST = '127.0.0.1:4600'

const attempt = (over = {}) => ({ path: '/api/projects', method: 'GET', host: HOST, ...over })

const verdict = (over, token = TOKEN) => decide(attempt(over), token)

test('a host that is not loopback is refused, whatever else it carries', () => {
  assert.equal(verdict({ host: 'evil.com', offered: TOKEN }), 'bad-host')
  assert.equal(verdict({ host: 'ccwt.example.com:4600', site: 'same-origin' }), 'bad-host')
})

test('every loopback spelling is allowed through the host check', () => {
  for (const host of ['127.0.0.1:4600', 'localhost:4600', '[::1]:4600', 'localhost']) {
    assert.equal(verdict({ host, site: 'same-origin' }), 'allow', host)
  }
})

test('hostname strips the port and keeps a bracketed v6 literal whole', () => {
  assert.equal(hostname('127.0.0.1:4600'), '127.0.0.1')
  assert.equal(hostname('[::1]:4600'), '[::1]')
  assert.equal(hostname('localhost'), 'localhost')
})

test('anything outside /api/ is served without a credential', () => {
  assert.equal(verdict({ path: '/overview' }), 'allow')
  assert.equal(verdict({ path: '/_nuxt/entry.js' }), 'allow')
})

test('the page ccwt served reaches its own api', () => {
  assert.equal(verdict({ site: 'same-origin', method: 'POST' }), 'allow')
  assert.equal(verdict({ site: 'same-origin' }), 'allow')
})

test('a page on another site cannot reach the api at all', () => {
  assert.equal(verdict({ site: 'cross-site', method: 'POST' }), 'cross-site')
  assert.equal(verdict({ site: 'cross-site' }), 'cross-site')
  assert.equal(verdict({ site: 'same-site', method: 'DELETE' }), 'cross-site')
})

test('a url typed into the address bar may read, but never write', () => {
  assert.equal(verdict({ site: 'none' }), 'allow')
  assert.equal(verdict({ site: 'none', method: 'POST' }), 'cross-site')
})

test('a browser too old for Sec-Fetch falls back to Origin', () => {
  assert.equal(verdict({ origin: `http://${HOST}`, method: 'POST' }), 'allow')
  assert.equal(verdict({ origin: 'http://evil.com', method: 'POST' }), 'cross-origin')
})

test('an Origin on the right host but the wrong port is another origin', () => {
  assert.equal(verdict({ origin: 'http://127.0.0.1:9999', method: 'POST' }), 'cross-origin')
})

test('a malformed Origin is refused rather than parsed generously', () => {
  assert.equal(verdict({ origin: 'not a url', method: 'POST' }), 'cross-origin')
})

test('a client carrying neither header needs the token', () => {
  assert.equal(verdict({}), 'unauthorized')
  assert.equal(verdict({ offered: 'wrong' }), 'unauthorized')
  assert.equal(verdict({ offered: TOKEN }), 'allow')
})

test('the token wins over Sec-Fetch, so a machine client is never guessing', () => {
  assert.equal(verdict({ site: 'cross-site', method: 'POST', offered: TOKEN }), 'allow')
  assert.equal(verdict({ site: 'none', method: 'POST', offered: TOKEN }), 'allow')
})

test('no token configured is dev, where a bare client is let through', () => {
  assert.equal(verdict({}, ''), 'allow')
  assert.equal(verdict({ offered: 'anything' }, ''), 'allow')
})

test('no token configured still refuses a cross-site page', () => {
  assert.equal(verdict({ site: 'cross-site', method: 'POST' }, ''), 'cross-site')
  assert.equal(verdict({ origin: 'http://evil.com', method: 'POST' }, ''), 'cross-origin')
  assert.equal(verdict({ host: 'evil.com' }, ''), 'bad-host')
})
