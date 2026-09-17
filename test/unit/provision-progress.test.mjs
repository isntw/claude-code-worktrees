import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { placeFiles } = await importLib('provision')

const RECIPE = {
  worktreesDir: '.claude/worktrees',
  provision: { copy: [], link: ['node_modules'], write: [], postCreate: [], postRemove: [] },
  services: [],
  claude: { ownWorktreeCreation: false },
}

const AT = { project: 'fixture', slug: 'one', rootPath: '', worktreePath: '' }

function fixture(scopes, packages) {
  const dir = mkdtempSync(join(tmpdir(), 'ccwt-progress-'))
  const root = join(dir, 'root')
  const worktree = join(dir, 'worktree')

  mkdirSync(worktree, { recursive: true })

  for (let scope = 0; scope < scopes; scope += 1) {
    for (let inner = 0; inner < packages; inner += 1) {
      const pack = join(root, 'node_modules', `@scope${scope}`, `pack${inner}`)
      mkdirSync(pack, { recursive: true })
      writeFileSync(join(pack, 'index.js'), 'module.exports = 1\n')
    }
  }

  return { dir, root, worktree }
}

test('linking a directory reports progress against a count taken one level down', async () => {
  const { dir, root, worktree } = fixture(4, 5)

  try {
    const seen = []
    await placeFiles(root, worktree, RECIPE, AT, false, (step) => seen.push(step))

    assert.ok(seen.length > 0, 'the watcher was never called')

    const first = seen[0]
    assert.equal(first.label, 'linking node_modules')
    assert.equal(first.done, 0)
    assert.equal(first.total, 0)

    const measured = seen.filter((step) => step.total > 0)
    for (const step of measured) {
      assert.equal(step.label, 'linking node_modules')
      assert.ok(step.done <= step.total, `${step.done} exceeded ${step.total}`)
      assert.equal(step.total, 20)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('refreshing says so in the label', async () => {
  const { dir, root, worktree } = fixture(2, 2)

  try {
    const seen = []
    await placeFiles(root, worktree, RECIPE, AT, true, (step) => seen.push(step))

    assert.ok(
      seen.some((step) => step.label === 'relinking node_modules'),
      'no relinking step was reported',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a watcher is optional', async () => {
  const { dir, root, worktree } = fixture(2, 2)

  try {
    const report = await placeFiles(root, worktree, RECIPE, AT, false)
    assert.deepEqual(report.linked, ['node_modules'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
