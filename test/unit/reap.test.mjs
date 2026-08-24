import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { reapWithin } = await importLib('holders')

const LISTEN =
  'require("net").createServer().listen(Number(process.argv[1]), "127.0.0.1", () => console.log("up"))'

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

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => done(port))
    })
  })
}

function listener(port, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['-e', LISTEN, String(port)], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    running.push(child)

    const giveUp = setTimeout(() => fail(new Error('the listener never came up')), 10_000)
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

function exits(child, withinMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)

  return new Promise((done) => {
    const giveUp = setTimeout(() => done(false), withinMs)
    child.once('exit', () => {
      clearTimeout(giveUp)
      done(true)
    })
  })
}

function dirs() {
  const dir = mkdtempSync(join(tmpdir(), 'ccwt-reap-'))
  trash.push(dir)
  const worktree = join(dir, 'worktree')
  const elsewhere = join(dir, 'elsewhere')
  mkdirSync(join(worktree, 'nested'), { recursive: true })
  mkdirSync(elsewhere, { recursive: true })
  return { worktree, nested: join(worktree, 'nested'), elsewhere }
}

test('stops a process holding the port from inside the worktree', async () => {
  const { worktree, nested } = dirs()
  const port = await freePort()
  const child = await listener(port, nested)
  const gone = exits(child, 5_000)

  const strays = await reapWithin(port, worktree)

  assert.equal(strays.length, 1)
  assert.equal(strays[0].pid, child.pid)
  assert.equal(await gone, true)
})

test('leaves a process alone when its cwd is outside the worktree', async () => {
  const { worktree, elsewhere } = dirs()
  const port = await freePort()
  const child = await listener(port, elsewhere)
  const gone = exits(child, 1_500)

  const strays = await reapWithin(port, worktree)

  assert.deepEqual(strays, [])
  assert.equal(await gone, false)
})

test('says nothing was holding a free port', async () => {
  const { worktree } = dirs()
  const port = await freePort()

  assert.deepEqual(await reapWithin(port, worktree), [])
})
