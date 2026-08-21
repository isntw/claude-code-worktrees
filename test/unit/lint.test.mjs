import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importLib } from '../helpers/tslib.mjs'

const { noteRecipe } = await importLib('lint')

const recipe = (services) => ({
  worktreesDir: '.claude/worktrees',
  provision: { copy: [], link: ['node_modules'], write: [], postCreate: [], postRemove: [] },
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

const about = (notes, path) => notes.filter((note) => note.path === path)

test('a port passed once draws nothing', () => {
  const notes = noteRecipe(recipe([service()]))

  assert.deepEqual(about(notes, 'services.0.env'), [])
  assert.deepEqual(about(notes, 'services.0.command'), [])
})

test('a port passed twice is a warning naming both places', () => {
  const notes = noteRecipe(
    recipe([service({ env: { NUXT_PORT: '{{port}}' } })]),
  )

  const said = about(notes, 'services.0.env')
  assert.equal(said.length, 1)
  assert.equal(said[0].severity, 'warning')
  assert.match(said[0].message, /2 ways/)
  assert.match(said[0].message, /command, env\.NUXT_PORT/)
})

test('every extra copy is counted, not just the second', () => {
  const notes = noteRecipe(
    recipe([service({ env: { NUXT_PORT: '{{port}}', NITRO_PORT: '{{port}}' } })]),
  )

  assert.match(about(notes, 'services.0.env')[0].message, /3 ways/)
})

test('a port mapped only under env is one place, not two', () => {
  const notes = noteRecipe(
    recipe([service({ command: 'npm run dev', env: { NUXT_PORT: '{{port}}' } })]),
  )

  assert.deepEqual(about(notes, 'services.0.env'), [])
})

test('a port passed nowhere still warns, and a pinned range only informs', () => {
  const loose = noteRecipe(recipe([service({ command: 'npm run dev' })]))
  assert.equal(about(loose, 'services.0.command')[0].severity, 'warning')

  const pinned = noteRecipe(
    recipe([service({ command: 'npm run dev', portRange: [3000, 3000] })]),
  )
  assert.equal(about(pinned, 'services.0.command')[0].severity, 'info')
})

test('a named port is not a second injection site', () => {
  const notes = noteRecipe(
    recipe([service({ ports: { PORT: [24678, 24698] } })]),
  )

  assert.deepEqual(notes, [])
})
