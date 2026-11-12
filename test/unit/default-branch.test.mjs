import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { defaultBranch } = await importLib('git')

const dir = mkdtempSync(join(tmpdir(), 'ccwt-branch-'))
after(() => rmSync(dir, { recursive: true, force: true }))

test('the default branch is read once and reused while it is fresh', async () => {
  execFileSync('git', ['init', '--initial-branch', 'main'], { cwd: dir })
  assert.equal(await defaultBranch(dir), 'main')

  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/other'], { cwd: dir })
  assert.equal(await defaultBranch(dir), 'main')
  assert.equal(defaultBranch(dir), defaultBranch(dir))
})
