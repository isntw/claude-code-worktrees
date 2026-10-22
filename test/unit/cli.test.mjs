import assert from 'node:assert/strict'
import { test } from 'node:test'
import { here, inputFor, matching } from '../../cli/ccwt.ts'

const root = { name: 'app', path: '/repo', root: true, services: [] }
const nested = { name: 'feature', path: '/repo/.claude/worktrees/feature', root: false, services: [] }

test('the worktree a directory is in is the deepest one containing it', () => {
  assert.equal(here([root, nested], '/repo/.claude/worktrees/feature/src'), nested)
  assert.equal(here([nested, root], '/repo/src'), root)
  assert.equal(here([root, nested], '/elsewhere'), null)
  assert.equal(here([root, nested], '/repo-other'), null)
})

test('flags map onto the tool inputs, aimed at a path', () => {
  assert.deepEqual(inputFor('up', 'feature', { service: 'web' }, '/repo'), {
    worktree: 'feature',
    service: 'web',
    takeOver: undefined,
    path: '/repo',
  })
  assert.deepEqual(inputFor('up', 'feature', { 'take-over': true }, '/repo'), {
    worktree: 'feature',
    service: undefined,
    takeOver: true,
    path: '/repo',
  })
  assert.deepEqual(inputFor('logs', undefined, { lines: '5', offset: '10' }, '/repo'), {
    worktree: undefined,
    service: undefined,
    limit: 5,
    offset: 10,
    path: '/repo',
  })
  assert.deepEqual(inputFor('repair', 'feature', { refresh: true }, '/repo'), { worktree: 'feature', refresh: true, path: '/repo' })
  assert.deepEqual(inputFor('ls', 'ignored', {}, '/repo'), { path: '/repo' })
})

test('a worktree name is matched by directory name across projects', () => {
  const one = { name: 'one', rootPath: '/one' }
  const two = { name: 'two', rootPath: '/two' }
  const found = [
    { project: one, paths: ['/one', '/one/.claude/worktrees/feature'] },
    { project: two, paths: ['/two', '/elsewhere/feature', '/two/featured'] },
  ]
  assert.deepEqual(matching(found, 'feature'), [
    { project: one, path: '/one/.claude/worktrees/feature' },
    { project: two, path: '/elsewhere/feature' },
  ])
  assert.deepEqual(matching(found, 'two'), [{ project: two, path: '/two' }])
  assert.deepEqual(matching(found, 'nope'), [])
})
