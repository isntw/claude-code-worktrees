import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { dropHome, makeHome } from '../helpers/home.mjs'
import { importLib } from '../helpers/tslib.mjs'

const logstore = await importLib('logstore')

const WORKTREE = 'abc123def456'

const line = (text, service = 'dev', stream = 'stdout') => ({
  worktreeId: WORKTREE,
  service,
  stream,
  at: new Date().toISOString(),
  text,
})

function withHome(work) {
  const home = makeHome()
  const previous = process.env.CCWT_HOME
  process.env.CCWT_HOME = home

  try {
    return work(home)
  } finally {
    logstore.forget(WORKTREE)
    if (previous === undefined) delete process.env.CCWT_HOME
    else process.env.CCWT_HOME = previous
    dropHome(home)
  }
}

test('a line written is a line read back, with its stream', () => {
  withHome(() => {
    logstore.append(line('Nuxt 4.5.0'))
    logstore.append(line('ERROR boom', 'dev', 'stderr'))

    const back = logstore.tail(WORKTREE, 'dev', 100)

    assert.equal(back.length, 2)
    assert.equal(back[0].text, 'Nuxt 4.5.0')
    assert.equal(back[0].stream, 'stdout')
    assert.equal(back[1].stream, 'stderr')
    assert.equal(back[1].service, 'dev')
  })
})

test('logs outlive the process that wrote them', () => {
  withHome((home) => {
    logstore.append(line('written once'))
    logstore.closeService(WORKTREE, 'dev')

    assert.ok(existsSync(join(home, 'logs', WORKTREE, 'dev.log')))
    assert.equal(logstore.tail(WORKTREE, 'dev', 10)[0].text, 'written once')
  })
})

test('a single enormous line is clamped and says so, rather than being kept whole', () => {
  withHome(() => {
    logstore.append(line('x'.repeat(50_000)))

    const stored = logstore.tail(WORKTREE, 'dev', 1)[0]

    assert.ok(stored.text.length < 9_000, `kept ${stored.text.length} characters`)
    assert.match(stored.text, /…\[truncated\]$/)
  })
})

test('the tail limit returns the newest lines, not the oldest', () => {
  withHome(() => {
    for (let index = 0; index < 50; index += 1) logstore.append(line(`line ${index}`))

    const back = logstore.tail(WORKTREE, 'dev', 10)

    assert.equal(back.length, 10)
    assert.equal(back[0].text, 'line 40')
    assert.equal(back[9].text, 'line 49')
  })
})

test('a worktree with several services reads back merged in time order', () => {
  withHome(() => {
    logstore.append(line('web up', 'web'))
    logstore.append(line('api up', 'api'))
    logstore.append(line('db up', 'db'))

    const all = logstore.tailAll(WORKTREE, 100)
    const services = new Set(all.map((entry) => entry.service))

    assert.deepEqual([...services].sort(), ['api', 'db', 'web'])

    const times = all.map((entry) => entry.at)
    assert.deepEqual(times, [...times].sort())
  })
})

test('a chatty service cannot push a quiet one out of the merged tail', () => {
  withHome(() => {
    logstore.append(line('server listening', 'server'))
    logstore.append(line('server ready', 'server'))
    for (let index = 0; index < 2_000; index += 1) logstore.append(line(`hmr ${index}`, 'web'))

    const all = logstore.tailAll(WORKTREE, 100)
    const server = all.filter((entry) => entry.service === 'server')

    assert.equal(all.length, 100)
    assert.deepEqual(
      server.map((entry) => entry.text),
      ['server listening', 'server ready'],
    )
  })
})

test('budget a service cannot use goes to one that can', () => {
  withHome(() => {
    for (let index = 0; index < 5; index += 1) logstore.append(line(`api ${index}`, 'api'))
    for (let index = 0; index < 500; index += 1) logstore.append(line(`web ${index}`, 'web'))

    const all = logstore.tailAll(WORKTREE, 100)
    const counts = new Map()
    for (const entry of all) counts.set(entry.service, (counts.get(entry.service) ?? 0) + 1)

    assert.equal(counts.get('api'), 5)
    assert.equal(counts.get('web'), 95)
  })
})

test('every service keeps a share of the budget, however many there are', () => {
  withHome(() => {
    for (const service of ['api', 'db', 'web', 'worker']) {
      for (let index = 0; index < 1_000; index += 1) logstore.append(line(`${service} ${index}`, service))
    }

    const all = logstore.tailAll(WORKTREE, 100)
    const counts = new Map()
    for (const entry of all) counts.set(entry.service, (counts.get(entry.service) ?? 0) + 1)

    assert.equal(all.length, 100)
    assert.deepEqual([...counts.values()], [25, 25, 25, 25])
  })
})

test('a merged tail still ends with the newest line of each service', () => {
  withHome(() => {
    for (let index = 0; index < 40; index += 1) logstore.append(line(`api ${index}`, 'api'))
    for (let index = 0; index < 40; index += 1) logstore.append(line(`web ${index}`, 'web'))

    const all = logstore.tailAll(WORKTREE, 20)
    const newest = (service) => all.filter((entry) => entry.service === service).at(-1).text

    assert.equal(newest('api'), 'api 39')
    assert.equal(newest('web'), 'web 39')
  })
})

test('growth is bounded by rotation, and the file stays readable across it', () => {
  withHome((home) => {
    const path = join(home, 'logs', WORKTREE, 'dev.log')

    for (let index = 0; index < 3_000; index += 1) logstore.append(line('y'.repeat(900)))

    const current = statSync(path).size
    const rolled = existsSync(`${path}.1`) ? statSync(`${path}.1`).size : 0

    assert.ok(rolled > 0, 'rotation should have happened')
    assert.ok(current + rolled < 4_200_000, `held ${current + rolled} bytes`)
    assert.equal(logstore.tail(WORKTREE, 'dev', 5).length, 5)
  })
})

test('a service name that is not a safe filename still gets a file', () => {
  withHome(() => {
    logstore.append(line('hello', 'Web/Server_1'))
    assert.equal(logstore.tail(WORKTREE, 'web-server-1', 10)[0].text, 'hello')
  })
})

test('forgetting a worktree removes every service log it owned', () => {
  withHome((home) => {
    logstore.append(line('one', 'web'))
    logstore.append(line('two', 'api'))

    logstore.forget(WORKTREE)

    assert.ok(!existsSync(join(home, 'logs', WORKTREE)))
    assert.deepEqual(logstore.tailAll(WORKTREE, 10), [])
  })
})

test('forgetting one service leaves the others alone', () => {
  withHome(() => {
    logstore.append(line('web line', 'web'))
    logstore.append(line('api line', 'api'))

    logstore.forgetService(WORKTREE, 'web')

    assert.deepEqual(logstore.tail(WORKTREE, 'web', 10), [])
    assert.equal(logstore.tail(WORKTREE, 'api', 10)[0].text, 'api line')
  })
})

test('reading a worktree that never logged anything is empty, not an error', () => {
  withHome(() => {
    assert.deepEqual(logstore.tailAll('never-ran', 10), [])
    assert.deepEqual(logstore.tail('never-ran', 'dev', 10), [])
  })
})
