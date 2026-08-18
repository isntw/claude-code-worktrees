import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changes, overview, renameTo, snapshot } from '../plugin/lib/report.mjs'

const worktree = (name, services, root = false) => ({ name, root, path: `/repo/${name}`, services })
const service = (name, port, up) => ({ name, port, up, command: 'npm run dev -- --port {{port}}' })

const repo = (worktrees, here = null) => ({
  projectName: 'demo',
  rootPath: '/repo',
  worktrees,
  here,
})

test('a snapshot ignores services with no allocated port', () => {
  const found = repo([worktree('one', [service('dev', 5270, true), service('api', null, false)])])

  assert.deepEqual(snapshot(found), { 'one/dev': { port: 5270, up: true } })
})

test('nothing changed says nothing', () => {
  const rows = { 'one/dev': { port: 5270, up: true } }

  assert.deepEqual(changes(rows, rows), [])
})

test('a service coming up is reported with its URL', () => {
  const lines = changes(
    { 'one/dev': { port: 5270, up: false } },
    { 'one/dev': { port: 5270, up: true } },
  )

  assert.deepEqual(lines, ['one/dev is now running at http://localhost:5270'])
})

test('a service stopping is reported without one', () => {
  const lines = changes(
    { 'one/dev': { port: 5270, up: true } },
    { 'one/dev': { port: 5270, up: false } },
  )

  assert.deepEqual(lines, ['one/dev has stopped'])
})

test('a moved port names both the old and the new', () => {
  const lines = changes(
    { 'one/dev': { port: 5270, up: true } },
    { 'one/dev': { port: 5312, up: true } },
  )

  assert.deepEqual(lines, [
    'one/dev moved to port 5312 (was 5270) and is running at http://localhost:5312',
  ])
})

test('a new worktree and a vanished one are both reported', () => {
  const lines = changes(
    { 'gone/dev': { port: 5266, up: false } },
    { 'fresh/dev': { port: 5270, up: true } },
  )

  assert.deepEqual(lines, [
    'fresh/dev → port 5270, running at http://localhost:5270',
    'gone/dev is gone',
  ])
})

test('a session in a worktree is named after it', () => {
  const here = worktree('feature', [service('dev', 5270, true)])

  assert.equal(renameTo(repo([here], here), undefined), 'ccwt · demo/feature')
})

test('a name already correct is not set again', () => {
  const here = worktree('feature', [service('dev', 5270, true)])

  assert.equal(renameTo(repo([here], here), 'ccwt · demo/feature'), null)
})

test('a generated name is claimed the first time, having set none before', () => {
  const here = worktree('feature', [service('dev', 5270, true)])

  assert.equal(
    renameTo(repo([here], here), 'Publishing repo with free-to-use license', undefined),
    'ccwt · demo/feature',
  )
})

test('a name changed after ours is never touched again', () => {
  const here = worktree('feature', [service('dev', 5270, true)])

  assert.equal(
    renameTo(repo([here], here), 'debugging the merge', 'ccwt · demo/first'),
    null,
  )
})

test('a name still equal to ours moves with the worktree', () => {
  const here = worktree('second', [service('dev', 5270, true)])

  assert.equal(
    renameTo(repo([here], here), 'ccwt · demo/first', 'ccwt · demo/first'),
    'ccwt · demo/second',
  )
})



test('the root checkout and an unknown directory are never renamed', () => {
  const root = worktree('demo', [service('dev', null, false)], true)

  assert.equal(renameTo(repo([root], root), undefined), null)
  assert.equal(renameTo(repo([root], null), undefined), null)
})

test('an overview lists only worktrees that have a port', () => {
  const found = repo([
    worktree('demo', [service('dev', null, false)], true),
    worktree('feature', [service('dev', 5270, true)]),
  ])

  const text = overview(found)

  assert.match(text, /feature — dev → 5270 running at http:\/\/localhost:5270/)
  assert.doesNotMatch(text, /demo \(root\)/)
})

test('a repository with no allocated ports produces no context at all', () => {
  const found = repo([worktree('demo', [service('dev', null, false)], true)])

  assert.equal(overview(found), null)
})
