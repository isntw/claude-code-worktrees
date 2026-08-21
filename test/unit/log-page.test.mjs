import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHARACTER_LIMIT, pageOf } from '../../plugin/src/mcp/answer.ts'

const lines = (count, width = 10) =>
  Array.from({ length: count }, (_, at) => ({
    service: 'dev',
    stream: 'stdout',
    text: `${at}`.padEnd(width, 'x'),
  }))

test('a short scrollback comes back whole', () => {
  const { lines: page, older, capped } = pageOf(lines(6), 100, 0)

  assert.equal(page.length, 6)
  assert.equal(older, 0)
  assert.equal(capped, false)
})

test('limit takes the newest lines, not the oldest', () => {
  const { lines: page, older, capped } = pageOf(lines(10), 3, 0)

  assert.deepEqual(page.map((line) => line.text.replace(/x+$/, '')), ['7', '8', '9'])
  assert.equal(older, 7)
  assert.equal(capped, false)
})

test('offset walks backwards through the scrollback', () => {
  const { lines: page, older } = pageOf(lines(10), 3, 3)

  assert.deepEqual(page.map((line) => line.text.replace(/x+$/, '')), ['4', '5', '6'])
  assert.equal(older, 4)
})

test('a page too large for one response is cut, and says it was', () => {
  const fat = lines(100, 8_192)
  const { lines: page, older, capped } = pageOf(fat, 100, 0)

  assert.ok(page.length < 100, 'the page must be smaller than the limit asked for')
  assert.equal(capped, true)
  assert.equal(older, 100 - page.length)

  const spent = page.reduce((total, line) => total + 2 * (line.text.length + line.service.length) + 50, 0)
  assert.ok(spent <= CHARACTER_LIMIT, `spent ${spent} must stay inside ${CHARACTER_LIMIT}`)
})

test('one line larger than the whole budget is still returned', () => {
  const { lines: page, capped } = pageOf(lines(1, CHARACTER_LIMIT * 2), 100, 0)

  assert.equal(page.length, 1)
  assert.equal(capped, false)
})

test('cutting for size is distinguishable from cutting for limit', () => {
  const byLimit = pageOf(lines(10), 3, 0)
  assert.equal(byLimit.capped, false)
  assert.ok(byLimit.older > 0)

  const bySize = pageOf(lines(100, 8_192), 100, 0)
  assert.equal(bySize.capped, true)
})

test('an offset past the end yields nothing rather than throwing', () => {
  const { lines: page, older } = pageOf(lines(4), 10, 99)

  assert.deepEqual(page, [])
  assert.equal(older, 0)
})
