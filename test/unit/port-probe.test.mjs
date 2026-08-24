import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { after, test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { isFree } = await importLib('ports')
const { holders } = await importLib('holders')

const open = []

after(async () => {
  await Promise.all(open.map((server) => new Promise((done) => server.close(done))))
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

function hold(port, where) {
  return new Promise((done, fail) => {
    const server = createServer()
    open.push(server)
    server.once('error', fail)
    server.listen({ port, ...where }, () => done(server))
  })
}

test('a port nobody holds is free', async () => {
  assert.equal(await isFree(await spare()), true)
})

test('a server bound to every interface is seen', async () => {
  const port = await spare()
  await hold(port, {})

  assert.equal(await isFree(port), false)
})

test('a server bound only to IPv6 loopback is seen', async () => {
  const port = await spare()
  await hold(port, { host: '::1', ipv6Only: true })

  assert.equal(await isFree(port), false)
})

test('a server bound only to IPv4 loopback is seen', async () => {
  const port = await spare()
  await hold(port, { host: '127.0.0.1' })

  assert.equal(await isFree(port), false)
})

test('a port nobody holds has no holders', async () => {
  const found = await holders(await spare())

  assert.equal(found.free, true)
  assert.deepEqual(found.ours, [])
  assert.deepEqual(found.foreign, [])
})

test('a server bound to every interface is named by its pid', async () => {
  const port = await spare()
  await hold(port, {})

  const found = await holders(port)

  assert.equal(found.free, false)
  assert.equal(
    found.foreign.some((holder) => holder.pid === process.pid),
    true,
  )
})
