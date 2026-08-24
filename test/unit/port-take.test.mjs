import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { after, test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { free } = await importLib('holders')

const DEAF =
  'process.on("SIGTERM", () => {});' +
  'require("net").createServer().listen(Number(process.argv[1]), () => console.log("up"))'

const running = []

after(() => {
  for (const child of running) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
})

function spare() {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => done(port))
    })
  })
}

function deaf(port) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['-e', DEAF, String(port)], {
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

test('a holder that ignores SIGTERM is killed rather than left on the port', async () => {
  const port = await spare()
  const child = await deaf(port)
  const gone = exits(child, 15_000)

  const outcome = await free(port, { pids: [child.pid], services: [] })

  assert.deepEqual(outcome.refused, [])
  assert.deepEqual(outcome.signalled, [child.pid])
  assert.equal(outcome.freed, true, outcome.why ?? 'the port was not freed')
  assert.equal(await gone, true)
})
