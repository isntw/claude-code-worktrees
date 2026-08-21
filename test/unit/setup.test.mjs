import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { describeSetup } = await importLib('setup')

const project = (files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'ccwt-setup-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

const recipe = (services, provision = {}) => ({
  worktreesDir: '.claude/worktrees',
  provision: { copy: [], link: [], write: [], postCreate: [], postRemove: [], ...provision },
  services,
  claude: { ownWorktreeCreation: false },
})

const service = (over = {}) => ({
  name: 'dev',
  cwd: '.',
  command: 'npm run dev -- --port {{port}}',
  portRange: [5200, 5299],
  ...over,
})

const titled = (setup, topic) => setup.notes.filter((note) => note.topic === topic).map((note) => note.title)
const snippetOf = (setup, title) => setup.notes.find((note) => note.title === title)?.snippet

test('an allocated range with nothing fixed runs side by side', async () => {
  const setup = await describeSetup(project(), recipe([service()], { link: ['node_modules'] }))

  assert.equal(setup.portMode, 'allocated')
  assert.equal(setup.headline, 'Nothing to configure — worktrees run side by side.')
  assert.deepEqual(titled(setup, 'together'), ['Two worktrees can serve at once'])
})

test('a pinned extra port pins the project', async () => {
  const setup = await describeSetup(
    project(),
    recipe([service({ ports: { API_PORT: [5433, 5433] } })]),
  )

  assert.equal(setup.portMode, 'fixed')
  assert.match(setup.headline, /one worktree at a time, because a port is pinned/)
  assert.equal(snippetOf(setup, 'One port is pinned'), 'dev.API_PORT  5433')
})

test('every port a service needs is listed with its range', async () => {
  const setup = await describeSetup(
    project(),
    recipe([service({ ports: { API_PORT: [5300, 5399] } })]),
  )

  assert.equal(
    snippetOf(setup, 'One service'),
    ['dev           any free 5200-5299', 'dev.API_PORT  any free 5300-5399'].join('\n'),
  )
})

test('the panel does not explain how ccwt hands a port over', async () => {
  const setup = await describeSetup(
    project(),
    recipe([service({ ports: { API_PORT: [5300, 5399] } })]),
  )

  assert.deepEqual(
    setup.notes.filter((note) => /CCWT_|PORT=/.test(note.body ?? '') || /CCWT_PORT/.test(note.snippet ?? '')),
    [],
  )
})

test('a service pinned to the port its config names is not called a fixed address', async () => {
  const root = project({ 'vite.config.ts': "export default { base: 'http://127.0.0.1:8080' }\n" })
  const setup = await describeSetup(root, recipe([service({ portRange: [8080, 8080] })]))

  assert.deepEqual(titled(setup, 'together'), ['One port is pinned'])
})

test('a fixed address is attributed to the service whose range covers it', async () => {
  const root = project({ 'vite.config.ts': "const api = 'http://127.0.0.1:5350'\n" })
  const setup = await describeSetup(
    root,
    recipe([service(), service({ name: 'api', portRange: [5300, 5399] })]),
  )

  assert.equal(setup.portMode, 'fixed')
  assert.match(
    snippetOf(setup, 'Optional — to run worktrees at the same time'),
    /process\.env\.CCWT_URL_API/,
  )
})

test('a stack every worktree would share is one worktree at a time', async () => {
  const setup = await describeSetup(
    project(),
    recipe([
      service({
        name: 'stack',
        kind: 'stack',
        command: 'docker compose -f compose.ccwt.yml --project-directory . up',
        env: { COMPOSE_PROJECT_NAME: 'demo' },
      }),
    ]),
  )

  assert.equal(setup.portMode, 'fixed')
  assert.match(setup.headline, /would share `stack`’s containers/)
  assert.ok(titled(setup, 'problems').includes('services.0.env.COMPOSE_PROJECT_NAME'))
})

test('a stack that varies per worktree can still run side by side', async () => {
  const setup = await describeSetup(
    project(),
    recipe([
      service({
        name: 'stack',
        kind: 'stack',
        command: 'docker compose -f compose.ccwt.yml --project-directory . up',
        env: { COMPOSE_PROJECT_NAME: 'ccwt-{{project}}-{{slug}}' },
        stopCommand: 'docker compose -f compose.ccwt.yml --project-directory . down',
        postStart: ['docker compose -f compose.ccwt.yml --project-directory . exec -T api npm run migrate'],
      }),
    ]),
  )

  assert.equal(setup.portMode, 'allocated')
  assert.deepEqual(titled(setup, 'services'), ['One service'])
  assert.equal(snippetOf(setup, 'One service'), 'stack  any free 5200-5299  stack')
})

test('what a worktree gets says how each thing got there', async () => {
  const setup = await describeSetup(
    project(),
    recipe([service()], {
      copy: ['.env'],
      link: ['node_modules'],
      write: [{ path: 'compose.ccwt.yml', content: 'services:\n' }],
      postCreate: ['npm ci'],
      postRemove: ['docker system prune -f'],
    }),
  )

  assert.deepEqual(titled(setup, 'files'), [
    '3 things are placed',
    'One command runs once',
    'Something runs on the way out',
  ])
  assert.equal(
    snippetOf(setup, '3 things are placed'),
    ['.env              copied', 'node_modules      hardlinked', 'compose.ccwt.yml  written'].join('\n'),
  )
})

test('a recipe that places nothing says so instead of claiming nothing to configure', async () => {
  const setup = await describeSetup(project(), recipe([service()]))

  assert.deepEqual(titled(setup, 'files'), [])
  assert.equal(setup.headline, 'Worktrees run side by side.')
  assert.ok(titled(setup, 'problems').includes('provision'))
})

test('a recipe with no services still says what a worktree gets', async () => {
  const setup = await describeSetup(project(), recipe([], { copy: ['.env'] }))

  assert.equal(setup.portMode, 'none')
  assert.equal(setup.headline, 'A recipe with no services.')
  assert.deepEqual(titled(setup, 'files'), ['One thing is placed'])
  assert.deepEqual(titled(setup, 'services'), ['Nothing keeps running'])
})

test('no recipe means no panel, because the page already says so', async () => {
  const setup = await describeSetup(project(), null)

  assert.equal(setup.portMode, 'none')
  assert.equal(setup.headline, 'No recipe yet.')
  assert.deepEqual(setup.notes, [])
})

test('start order rides along in the table instead of its own note', async () => {
  const setup = await describeSetup(
    project(),
    recipe([
      service({ name: 'api', portRange: [5300, 5399], postStart: ['npm run seed'] }),
      service({ dependsOn: ['api'] }),
    ]),
  )

  assert.deepEqual(titled(setup, 'services'), ['2 services'])
  assert.equal(
    snippetOf(setup, '2 services'),
    ['api  any free 5300-5399', 'dev  any free 5200-5299  after api'].join('\n'),
  )
})

test('a mix of pinned and free ports is not called all pinned', async () => {
  const setup = await describeSetup(
    project(),
    recipe([service({ portRange: [3000, 3000], ports: { API_PORT: [5300, 5399] } })]),
  )

  const body = setup.notes.find((note) => note.title === 'One service')?.body

  assert.match(body, /a pinned one is the port it says/)
  assert.equal(
    snippetOf(setup, 'One service'),
    ['dev           pinned 3000', 'dev.API_PORT  any free 5300-5399'].join('\n'),
  )
})
