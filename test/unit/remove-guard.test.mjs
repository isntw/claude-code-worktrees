import assert from 'node:assert/strict'
import { test } from 'node:test'
import { within } from '../../plugin/src/mcp/reach.ts'

test('a directory is within itself, so a session cannot remove where it stands', () => {
  assert.equal(within('/repo/.worktrees/feature', '/repo/.worktrees/feature'), true)
})

test('a session deeper inside the worktree is still inside it', () => {
  assert.equal(within('/repo/.worktrees/feature', '/repo/.worktrees/feature/app/pages'), true)
})

test('a sibling sharing the name as a prefix is a different worktree', () => {
  assert.equal(within('/repo/.worktrees/feature', '/repo/.worktrees/feature-two'), false)
})

test('the worktree that contains this one is not inside it', () => {
  assert.equal(within('/repo/.worktrees/feature', '/repo/.worktrees'), false)
})

test('a trailing slash and a relative step name the same place', () => {
  assert.equal(within('/repo/.worktrees/feature/', '/repo/.worktrees/feature/app/..'), true)
})

test('two unrelated paths stay unrelated', () => {
  assert.equal(within('/repo/.worktrees/feature', '/elsewhere/feature'), false)
})
