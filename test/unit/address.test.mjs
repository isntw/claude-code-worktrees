import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { withHome, writeJson } from '../helpers/home.mjs'
import { importLib } from '../helpers/tslib.mjs'

const address = await importLib('address')

test('with nothing saved the address is the documented default', async () => {
  await withHome(async () => {
    assert.deepEqual(await address.readAddress(), { port: 4600 })
  })
})

test('a saved port is read back', async () => {
  await withHome(async (home) => {
    writeJson(home, 'config.json', { port: 4700 })

    assert.deepEqual(await address.readAddress(), { port: 4700 })
  })
})

test('an unusable saved port keeps the default rather than moving the server nowhere', async () => {
  await withHome(async (home) => {
    writeJson(home, 'config.json', { port: 80 })

    assert.deepEqual(await address.readAddress(), { port: 4600 })
  })
})

test('an unparseable address reads as the default rather than throwing', async () => {
  await withHome(async (home) => {
    writeJson(home, 'config.json', '{not json')

    assert.deepEqual(await address.readAddress(), { port: 4600 })
  })
})

test('a saved host is not part of the address — the bind is the launcher flag alone', async () => {
  await withHome(async (home) => {
    writeJson(home, 'config.json', { host: '::1', port: 4700 })

    assert.deepEqual(await address.readAddress(), { port: 4700 })
  })
})

test('a port outside the usable range is refused', async () => {
  await withHome(async () => {
    await assert.rejects(() => address.writeAddress({ port: 80 }), /1024/)
    await assert.rejects(() => address.writeAddress({ port: 70_000 }), /1024/)
    await assert.rejects(() => address.writeAddress({ port: 4600.5 }), /1024/)
  })
})

test('a written address lands in ~/.ccwt/config.json, readable only by its owner', async () => {
  await withHome(async (home) => {
    await address.writeAddress({ port: 4800 })

    const path = join(home, 'config.json')
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { port: 4800 })
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.deepEqual(await address.readAddress(), { port: 4800 })
  })
})

test('writing an address drops a host that was saved before, rather than carrying it', async () => {
  await withHome(async (home) => {
    writeJson(home, 'config.json', { host: '::1', port: 4700 })

    await address.writeAddress({ port: 4800 })

    assert.deepEqual(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')), { port: 4800 })
  })
})
