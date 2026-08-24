import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { worktreePathFor } = await importLib('provision')

const ROOT = '/repos/portal'

const recipe = (worktreesDir) => ({
  worktreesDir,
  provision: { copy: [], link: [], write: [], postCreate: [], postRemove: [] },
  services: [],
  claude: { ownWorktreeCreation: false },
})

test('a worktrees folder inside the repository holds worktrees directly', () => {
  const path = worktreePathFor(ROOT, recipe('.claude/worktrees'), 'portal', 'tooltip')

  assert.equal(path, '/repos/portal/.claude/worktrees/tooltip')
})

test('the same folder Claude Code uses gets the same shape Claude Code uses', () => {
  const ours = worktreePathFor(ROOT, recipe('.claude/worktrees'), 'portal', 'tooltip')

  assert.equal(ours, `${ROOT}/.claude/worktrees/tooltip`)
})

test('a folder outside the repository keeps the project apart, since repositories share it', () => {
  const mine = worktreePathFor(ROOT, recipe('../.worktrees'), 'portal', 'tooltip')
  const yours = worktreePathFor('/repos/admin', recipe('../.worktrees'), 'admin', 'tooltip')

  assert.equal(mine, '/repos/.worktrees/portal/tooltip')
  assert.notEqual(mine, yours)
})

test('an absolute shared folder keeps the project segment too', () => {
  const path = worktreePathFor(ROOT, recipe('/shared/worktrees'), 'portal', 'tooltip')

  assert.equal(path, '/shared/worktrees/portal/tooltip')
})
