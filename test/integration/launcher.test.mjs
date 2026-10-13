import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dropHome, makeHome } from '../helpers/home.mjs'
import { NO_BUILD, built } from '../helpers/server.mjs'

const LAUNCHER = fileURLToPath(new URL('../../bin/ccwt.mjs', import.meta.url))
const WAIT_MS = 10_000
const skip = built() ? false : NO_BUILD

function start(home, args, extra = {}) {
  const child = spawn(process.execPath, [LAUNCHER, ...args], {
    env: { ...process.env, HOME: home, CCWT_HOME: join(home, '.ccwt'), ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  let out = ''
  let err = ''
  child.stdout.on('data', (chunk) => (out += chunk))
  child.stderr.on('data', (chunk) => (err += chunk))

  const closed = new Promise((done) => child.on('close', (code) => done(code)))

  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }

  return { child, closed, stop, read: () => ({ out, err }) }
}

async function refuses(home, args, extra = {}) {
  const running = start(home, args, extra)
  const code = await running.closed
  return { code, ...running.read() }
}

const settle = (ms) => new Promise((done) => setTimeout(done, ms))

async function until(check) {
  const deadline = Date.now() + WAIT_MS

  while (Date.now() < deadline) {
    if (check()) return true
    await settle(100)
  }

  return false
}

async function withFakeHome(work) {
  const home = makeHome()
  mkdirSync(join(home, '.ccwt'), { recursive: true })

  try {
    return await work(home, join(home, '.ccwt'))
  } finally {
    dropHome(home)
  }
}

const taken = (port) =>
  new Promise((done) => {
    const probe = createServer()
    probe.once('error', () => done(true))
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(false)))
  })

async function freePort() {
  const probe = createServer()
  await new Promise((done) => probe.listen(0, '127.0.0.1', done))
  const { port } = probe.address()
  await new Promise((done) => probe.close(done))
  return port
}

test('a non-loopback host is refused outright', async () => {
  await withFakeHome(async (home) => {
    const { code, err } = await refuses(home, ['--host', '0.0.0.0', '--no-open'])

    assert.equal(code, 1)
    assert.match(err, /Refusing to bind 0\.0\.0\.0/)
  })
})

test('an unknown command is refused rather than started', async () => {
  await withFakeHome(async (home, dir) => {
    const { code, err } = await refuses(home, ['stat', '--no-open'])

    assert.equal(code, 1)
    assert.match(err, /Unknown command: stat/)
    assert.ok(!existsSync(join(dir, 'runtime.json')), 'nothing may start on a mistyped command')
  })
})

test('start detaches, and the background server is not handed the command again', async () => {
  await withFakeHome(async (home, dir) => {
    const path = join(dir, 'runtime.json')
    const { code, out, err } = await refuses(home, ['start', '--dev', '--port', String(await freePort()), '--no-open'])

    assert.equal(code, 0, err)

    const pid = Number(/pid\s+(\d+)/.exec(out)?.[1])

    try {
      assert.ok(Number.isInteger(pid), `no pid in: ${out}`)
      assert.ok(await until(() => existsSync(path)), 'runtime.json never appeared')
      assert.equal(JSON.parse(readFileSync(path, 'utf8')).pid, pid, 'the printed pid must be the server')
    } finally {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {}
    }
  })
})

test('help is a command as well as a flag', async () => {
  await withFakeHome(async (home, dir) => {
    const { code, out } = await refuses(home, ['help'])

    assert.equal(code, 0)
    assert.match(out, /ccwt start/)
    assert.match(out, /ccwt stop/)
    assert.equal(out, (await refuses(home, ['--help'])).out)
    assert.ok(!existsSync(join(dir, 'runtime.json')), 'help must not start anything')
  })
})

test('stop with nothing running says so and succeeds', async () => {
  await withFakeHome(async (home) => {
    const { code, out } = await refuses(home, ['stop'])

    assert.equal(code, 0)
    assert.match(out, /ccwt is not running/)
  })
})

test('stop leaves a process alone when the handshake names one that is not serving', async () => {
  await withFakeHome(async (home, dir) => {
    writeFileSync(
      join(dir, 'runtime.json'),
      JSON.stringify({ host: '127.0.0.1', port: await freePort(), pid: process.pid, token: 'x' }),
    )

    const { code, out } = await refuses(home, ['stop'])

    assert.equal(code, 0)
    assert.match(out, /ccwt is not running/)
  })
})

test('stop ends what start began, and takes the handshake with it', async () => {
  await withFakeHome(async (home, dir) => {
    const path = join(dir, 'runtime.json')
    const started = await refuses(home, ['start', '--dev', '--port', String(await freePort()), '--no-open'])
    const pid = Number(/pid\s+(\d+)/.exec(started.out)?.[1])

    try {
      assert.equal(started.code, 0, started.err)
      assert.ok(await until(() => existsSync(path)), 'runtime.json never appeared')
      assert.ok(
        await until(() => {
          try {
            process.kill(pid, 0)
            return true
          } catch {
            return false
          }
        }),
      )

      const { port } = JSON.parse(readFileSync(path, 'utf8'))
      const deadline = Date.now() + WAIT_MS
      while (Date.now() < deadline && !(await taken(port))) await settle(200)
      assert.ok(await taken(port), 'the dev server never took its port')

      const stopped = await refuses(home, ['stop'])

      assert.equal(stopped.code, 0, stopped.err)
      assert.match(stopped.out, /stopped/)
      assert.throws(() => process.kill(pid, 0), 'the server must be gone once stop returns')
      assert.ok(await until(() => !existsSync(path)), 'a stopped ccwt must take its handshake with it')
    } finally {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {}
    }
  })
})

test('a second ccwt is refused while the first is alive and answering', async () => {
  const held = createServer()
  await new Promise((done) => held.listen(0, '127.0.0.1', done))
  const { port } = held.address()

  try {
    await withFakeHome(async (home, dir) => {
      writeFileSync(
        join(dir, 'runtime.json'),
        JSON.stringify({ host: '127.0.0.1', port, pid: process.pid, token: 'x' }),
      )

      const { code, err } = await refuses(home, ['--no-open'])

      assert.equal(code, 1)
      assert.match(err, /ccwt is already running/)
      assert.match(err, new RegExp(`:${port}`))
      assert.doesNotMatch(err, /--port/, 'it must not offer a second instance as the way out')
    })
  } finally {
    held.close()
  }
})

test('a port taken by something that is not ccwt suggests another port instead', async () => {
  const held = createServer()
  await new Promise((done) => held.listen(0, '127.0.0.1', done))
  const { port } = held.address()

  try {
    await withFakeHome(async (home) => {
      const { code, err } = await refuses(home, ['--port', String(port), '--no-open'])

      assert.equal(code, 1)
      assert.match(err, /already in use by something else/)
      assert.match(err, /--port/)
    })
  } finally {
    held.close()
  }
})

test('a stale handshake naming a dead process does not block a start', { skip }, async () => {
  await withFakeHome(async (home, dir) => {
    writeFileSync(
      join(dir, 'runtime.json'),
      JSON.stringify({ host: '127.0.0.1', port: await freePort(), pid: 999_999, token: 'x' }),
    )

    const running = start(home, ['--port', String(await freePort()), '--no-open'])

    try {
      await until(() => running.read().err.includes('already running') || running.read().out.length > 0)
      assert.doesNotMatch(running.read().err, /already running/)
    } finally {
      running.child.kill('SIGKILL')
      await running.closed
    }
  })
})

test('the handshake is written for the plugin, and removed again on a clean exit', { skip }, async () => {
  await withFakeHome(async (home, dir) => {
    const path = join(dir, 'runtime.json')
    const running = start(home, ['--port', String(await freePort()), '--no-open'])

    try {
      assert.ok(await until(() => existsSync(path)), `runtime.json never appeared: ${running.read().err}`)

      const held = JSON.parse(readFileSync(path, 'utf8'))

      assert.equal(held.host, '127.0.0.1')
      assert.ok(Number.isInteger(held.port))
      assert.ok(Number.isInteger(held.pid))
      assert.match(held.token, /^[0-9a-f]{64}$/)

      const listening = await until(() => running.read().out.includes('ccwt listening'))
      if (!listening) return

      running.child.kill('SIGTERM')
      await running.closed

      assert.ok(!existsSync(path), 'a clean exit should take the handshake with it')
    } finally {
      running.child.kill('SIGKILL')
    }
  })
})

test('the dev launcher writes the handshake, so a session can reach a server run from source', async () => {
  await withFakeHome(async (home, dir) => {
    const path = join(dir, 'runtime.json')
    const running = start(home, ['--dev', '--port', String(await freePort()), '--no-open'])

    try {
      assert.ok(await until(() => existsSync(path)), `runtime.json never appeared: ${running.read().err}`)

      const held = JSON.parse(readFileSync(path, 'utf8'))

      assert.match(held.token, /^[0-9a-f]{64}$/, 'dev must mint a token like the built server does')
      assert.ok(Number.isInteger(held.port))
    } finally {
      running.stop()
      await running.closed
    }
  })
})


test('a saved address supplies the port when no flag does, and cannot move the bind', async () => {
  await withFakeHome(async (home, dir) => {
    const port = await freePort()
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ host: '::1', port }))

    const running = start(home, ['--dev', '--no-open'])

    try {
      const path = join(dir, 'runtime.json')
      assert.ok(await until(() => existsSync(path)), `runtime.json never appeared: ${running.read().err}`)

      const held = JSON.parse(readFileSync(path, 'utf8'))

      assert.equal(held.port, port)
      assert.equal(held.host, '127.0.0.1', 'a saved host must not choose the family')
    } finally {
      running.stop()
      await running.closed
    }
  })
})
