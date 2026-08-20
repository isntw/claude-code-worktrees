import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { withHome, writeJson } from '../helpers/home.mjs'
import { importLib } from '../helpers/tslib.mjs'

const address = await importLib('address')

test('with nothing saved the address is the documented default', async () => {
  await withHome(async () => {
    assert.deepEqual(await address.readAddress(), { host: '127.0.0.1', port: 4600 })
  })
})

test('a saved address is read back', async () => {
  await withHome(async (home) => {
    writeJson(home, 'config.json', { host: 'localhost', port: 4700 })

    assert.deepEqual(await address.readAddress(), { host: 'localhost', port: 4700 })
  })
})

test('a half-written address keeps the default for the field it omits', async () => {
  await withHome(async (home) => {
    writeJson(home, 'config.json', { port: 4700 })

    assert.deepEqual(await address.readAddress(), { host: '127.0.0.1', port: 4700 })
  })
})

test('an unparseable address reads as the default rather than throwing', async () => {
  await withHome(async (home) => {
    writeJson(home, 'config.json', '{not json')

    assert.deepEqual(await address.readAddress(), { host: '127.0.0.1', port: 4600 })
  })
})

test('a host that is not loopback is refused, because a reachable ccwt is RCE', async () => {
  await withHome(async () => {
    await assert.rejects(
      () => address.writeAddress({ host: '0.0.0.0', port: 4600 }),
      /loopback only/,
    )
  })
})

test('a saved host outside loopback is ignored on the way back in', async () => {
  await withHome(async (home) => {
    writeJson(home, 'config.json', { host: '0.0.0.0', port: 4700 })

    assert.equal((await address.readAddress()).host, '127.0.0.1')
  })
})

test('a port outside the usable range is refused', async () => {
  await withHome(async () => {
    await assert.rejects(() => address.writeAddress({ host: '127.0.0.1', port: 80 }), /1024/)
    await assert.rejects(() => address.writeAddress({ host: '127.0.0.1', port: 70_000 }), /1024/)
    await assert.rejects(() => address.writeAddress({ host: '127.0.0.1', port: 4600.5 }), /1024/)
  })
})

test('a written address lands in ~/.ccwt/config.json, readable only by its owner', async () => {
  await withHome(async (home) => {
    await address.writeAddress({ host: '::1', port: 4800 })

    const path = join(home, 'config.json')
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { host: '::1', port: 4800 })
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.deepEqual(await address.readAddress(), { host: '::1', port: 4800 })
  })
})
