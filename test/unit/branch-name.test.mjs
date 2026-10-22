import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { importShared } from '../helpers/tslib.mjs'

const { branchName, slugify } = await importShared('route-keys')

const valid = (branch) => {
  try {
    execFileSync('git', ['check-ref-format', '--branch', branch], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test('a branch keeps the case the name was given in', () => {
  assert.equal(branchName('MTECH-6388-refund-flow-2'), 'MTECH-6388-refund-flow-2')
  assert.equal(slugify('MTECH-6388-refund-flow-2'), 'mtech-6388-refund-flow-2')
  assert.equal(branchName('  Feature/Login  '), 'Feature/Login')
})

test('what a ref may not carry becomes a dash', () => {
  assert.equal(branchName('Fix the Login page'), 'Fix-the-Login-page')
  assert.equal(branchName('a~b^c:d?e*f[g\\h'), 'a-b-c-d-e-f-g-h')
  assert.equal(branchName('a..b'), 'a-b')
  assert.equal(branchName('a@{b'), 'a-b')
  assert.equal(branchName('a//b'), 'a/b')
  assert.equal(branchName('-lead/'), 'lead')
  assert.equal(branchName('trail.'), 'trail')
})

test('what comes out passes git check-ref-format', () => {
  for (const name of ['MTECH-1 refund', 'a~b^c:d', 'x..y', '-dash', 'q@{1}', 'end.', 'a//b', ' tabs\there '])
    assert.ok(valid(branchName(name)), name)
})

test('what git still refuses is left for the slug fallback', () => {
  assert.equal(valid(branchName('x.lock')), false)
  assert.equal(valid(slugify('x.lock')), true)
})
