import assert from 'node:assert/strict'
import { test } from 'node:test'
import { here, inputFor } from '../../cli/ccwt.ts'

const root = { name: 'app', path: '/repo', root: true, services: [] }
const nested = { name: 'feature', path: '/repo/.claude/worktrees/feature', root: false, services: [] }

test('the worktree a directory is in is the deepest one containing it', () => {
  assert.equal(here([root, nested], '/repo/.claude/worktrees/feature/src'), nested)
  assert.equal(here([nested, root], '/repo/src'), root)
  assert.equal(here([root, nested], '/elsewhere'), null)
  assert.equal(here([root, nested], '/repo-other'), null)
})

test('flags map onto the tool inputs', () => {
  assert.deepEqual(inputFor('up', 'feature', { service: 'web' }), { worktree: 'feature', service: 'web' })
  assert.deepEqual(inputFor('logs', undefined, { lines: '5', offset: '10' }), {
    worktree: undefined,
    service: undefined,
    limit: 5,
    offset: 10,
  })
  assert.deepEqual(inputFor('repair', 'feature', { refresh: true }), { worktree: 'feature', refresh: true })
  assert.deepEqual(inputFor('ls', '/repo', {}), { path: '/repo' })
})
