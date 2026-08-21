import assert from 'node:assert/strict'
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { divergedBeneath, missingBeneath } = await importLib('provision')

const ENTRY = 'node_modules'

const OLD = new Date('2026-08-20T16:47:23Z')
const NOW = new Date('2026-08-21T08:27:18Z')

function trees() {
  const dir = mkdtempSync(join(tmpdir(), 'ccwt-drift-'))
  const root = join(dir, 'root', ENTRY)
  const worktree = join(dir, 'worktree', ENTRY)

  mkdirSync(root, { recursive: true })
  mkdirSync(worktree, { recursive: true })

  return { dir, root, worktree }
}

function pack(base, name, version) {
  mkdirSync(join(base, name), { recursive: true })
  writeFileSync(join(base, name, 'package.json'), JSON.stringify({ name, version }))
  writeFileSync(join(base, name, 'index.js'), `module.exports = '${version}'\n`)
}

function share(root, worktree, name) {
  mkdirSync(join(worktree, name), { recursive: true })
  for (const file of ['package.json', 'index.js']) {
    linkSync(join(root, name, file), join(worktree, name, file))
  }
}

function stamp(path, when) {
  utimesSync(path, when, when)
}

const diverged = ({ root, worktree }) => divergedBeneath(ENTRY, root, worktree)
const missing = ({ root, worktree }) => missingBeneath(ENTRY, root, worktree)

test('a scratch directory a tool wrote into is not drift, whatever its mtime says', async (t) => {
  const trio = trees()
  t.after(() => rmSync(trio.dir, { recursive: true, force: true }))

  pack(trio.root, 'left', '1.0.0')
  share(trio.root, trio.worktree, 'left')

  for (const base of [trio.root, trio.worktree]) mkdirSync(join(base, '.scratch'))
  stamp(join(trio.root, '.scratch'), NOW)
  stamp(join(trio.worktree, '.scratch'), OLD)

  assert.equal(await diverged(trio), false)
})

test('a directory of symlinks is not drift, though nothing in it is shared', async (t) => {
  const trio = trees()
  t.after(() => rmSync(trio.dir, { recursive: true, force: true }))

  pack(trio.root, 'left', '1.0.0')
  share(trio.root, trio.worktree, 'left')

  for (const base of [trio.root, trio.worktree]) {
    mkdirSync(join(base, '.bin'))
    symlinkSync('../left/index.js', join(base, '.bin', 'left'))
  }
  stamp(join(trio.root, '.bin'), NOW)
  stamp(join(trio.worktree, '.bin'), OLD)

  assert.equal(await diverged(trio), false)
})

test('a dependency the root replaced at the same name is drift', async (t) => {
  const trio = trees()
  t.after(() => rmSync(trio.dir, { recursive: true, force: true }))

  pack(trio.root, 'left', '1.0.0')
  share(trio.root, trio.worktree, 'left')

  rmSync(join(trio.root, 'left'), { recursive: true, force: true })
  pack(trio.root, 'left', '2.0.0')
  stamp(join(trio.root, 'left'), NOW)
  stamp(join(trio.worktree, 'left'), OLD)

  assert.equal(await diverged(trio), true)
})

test('a file the root rewrote is drift', async (t) => {
  const trio = trees()
  t.after(() => rmSync(trio.dir, { recursive: true, force: true }))

  writeFileSync(join(trio.root, '.package-lock.json'), '{}')
  linkSync(join(trio.root, '.package-lock.json'), join(trio.worktree, '.package-lock.json'))

  rmSync(join(trio.root, '.package-lock.json'))
  writeFileSync(join(trio.root, '.package-lock.json'), '{"name":"next"}')

  assert.equal(await diverged(trio), true)
})

test('a scratch directory only the root has is nothing to be short of', async (t) => {
  const trio = trees()
  t.after(() => rmSync(trio.dir, { recursive: true, force: true }))

  pack(trio.root, 'left', '1.0.0')
  share(trio.root, trio.worktree, 'left')
  mkdirSync(join(trio.root, '.scratch'))

  assert.equal(await missing(trio), false)
})

test('a dependency only the root has is missing', async (t) => {
  const trio = trees()
  t.after(() => rmSync(trio.dir, { recursive: true, force: true }))

  pack(trio.root, 'left', '1.0.0')
  share(trio.root, trio.worktree, 'left')
  pack(trio.root, 'right', '1.0.0')

  assert.equal(await missing(trio), true)
})

test('a worktree with no linked directory at all is missing it', async (t) => {
  const trio = trees()
  t.after(() => rmSync(trio.dir, { recursive: true, force: true }))

  pack(trio.root, 'left', '1.0.0')
  rmSync(trio.worktree, { recursive: true, force: true })

  assert.equal(await missing(trio), true)
  assert.equal(await diverged(trio), false)
})
