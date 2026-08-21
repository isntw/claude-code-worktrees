import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { environmentFor } = await importLib('supervisor')

const service = (over = {}) => ({
  name: 'web',
  cwd: '.',
  command: 'npm run dev -- --port {{port}}',
  portRange: [5200, 5299],
  ...over,
})

const vars = (over = {}) => ({
  project: 'demo',
  port: 5201,
  ports: { web: 5201, api: 5301 },
  named: {},
  slug: 'feature',
  branch: 'feature',
  rootPath: '/repo',
  worktreePath: '/repo/.claude/worktrees/demo/feature',
  ...over,
})

const ccwt = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('CCWT_')))

test('a service is given its own port and every service’s URL', () => {
  const env = environmentFor(service(), 5201, vars())

  assert.equal(env.PORT, '5201')
  assert.deepEqual(ccwt(env), {
    CCWT_URL_WEB: 'http://localhost:5201',
    CCWT_URL_API: 'http://localhost:5301',
  })
})

test('no port is exported under a CCWT_PORT name', () => {
  const env = environmentFor(service(), 5201, vars({ named: { DB_PORT: 33061 } }))

  assert.deepEqual(
    Object.keys(env).filter((key) => key.startsWith('CCWT_PORT')),
    [],
  )
})

test('a recipe-named port arrives under its own name', () => {
  const env = environmentFor(service(), 5201, vars({ named: { DB_PORT: 33061 } }))

  assert.equal(env.DB_PORT, '33061')
  assert.equal(env.CCWT_URL_DB_PORT, 'http://localhost:33061')
})

test('a name with a dash becomes one underscored key', () => {
  const env = environmentFor(service({ name: 'web-api' }), 5201, vars({ ports: { 'web-api': 5201 } }))

  assert.equal(env.CCWT_URL_WEB_API, 'http://localhost:5201')
})

test('the recipe’s own env is rendered and wins', () => {
  const env = environmentFor(
    service({ env: { WEB_PORT: '{{port}}', CCWT_URL_WEB: 'mine' } }),
    5201,
    vars(),
  )

  assert.equal(env.WEB_PORT, '5201')
  assert.equal(env.CCWT_URL_WEB, 'mine')
})
