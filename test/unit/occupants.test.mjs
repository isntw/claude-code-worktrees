import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { occupants } = await importLib('occupants')

const IDLE = 'setInterval(() => {}, 1000); console.log("up")'

const PARENT =
  'const { spawn } = require("child_process");' +
  'const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore"});' +
  'setInterval(() => {}, 1000);' +
  'console.log(kid.pid)'

const running = []
const trash = []

after(() => {
  for (const child of running) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
  for (const dir of trash) rmSync(dir, { recursive: true, force: true })
})

function dirs() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ccwt-occupants-')))
  trash.push(dir)

  const worktree = join(dir, 'worktree')
  const elsewhere = join(dir, 'elsewhere')
  mkdirSync(join(worktree, 'nested'), { recursive: true })
  mkdirSync(elsewhere, { recursive: true })

  return { worktree, nested: join(worktree, 'nested'), elsewhere }
}

function parenting(cwd) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['-e', PARENT], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    running.push(child)

    const giveUp = setTimeout(() => fail(new Error('the process never came up')), 10_000)
    child.stdout.once('data', (out) => {
      clearTimeout(giveUp)
      done({ pid: child.pid, kid: Number(String(out).trim()) })
    })
    child.once('error', (cause) => {
      clearTimeout(giveUp)
      fail(cause)
    })
  })
}

function idling(cwd) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['-e', IDLE], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    running.push(child)

    const giveUp = setTimeout(() => fail(new Error('the process never came up')), 10_000)
    child.stdout.once('data', () => {
      clearTimeout(giveUp)
      done(child)
    })
    child.once('error', (cause) => {
      clearTimeout(giveUp)
      fail(cause)
    })
  })
}

test('names a process whose working directory is the worktree', async () => {
  const { worktree } = dirs()
  const child = await idling(worktree)

  const found = await occupants(worktree)

  const mine = found.occupants.find((one) => one.pid === child.pid)
  assert.ok(mine, 'the process is named')
  assert.equal(mine.cwd, worktree)
  assert.equal(mine.ours, false)
  assert.match(mine.command, /node/)
})

test('names one standing in a subdirectory of the worktree', async () => {
  const { worktree, nested } = dirs()
  const child = await idling(nested)

  const found = await occupants(worktree)

  assert.equal(
    found.occupants.some((one) => one.pid === child.pid),
    true,
  )
})

test('leaves out a process working outside the worktree', async () => {
  const { worktree, elsewhere } = dirs()
  const child = await idling(elsewhere)

  const found = await occupants(worktree)

  assert.equal(
    found.occupants.some((one) => one.pid === child.pid),
    false,
  )
})

test('marks a service ccwt started as its own, so removal is not warned about twice', async () => {
  const { worktree } = dirs()
  const child = await idling(worktree)

  const found = await occupants(worktree, [child.pid])

  const mine = found.occupants.find((one) => one.pid === child.pid)
  assert.ok(mine, 'the process is still named')
  assert.equal(mine.ours, true)
})

test('an empty worktree has nobody standing in it', async () => {
  const { worktree } = dirs()

  const found = await occupants(worktree)

  assert.deepEqual(found.occupants, [])
  assert.equal(found.why, null)
})

test('a child of a service ccwt started is ours too, since removal kills the group', async () => {
  const { worktree } = dirs()
  const { pid, kid } = await parenting(worktree)

  const found = await occupants(worktree, [pid])

  const grandchild = found.occupants.find((one) => one.pid === kid)
  assert.ok(grandchild, 'the child is named')
  assert.equal(grandchild.ours, true, 'it shares the service process group, so removal takes it')
})
