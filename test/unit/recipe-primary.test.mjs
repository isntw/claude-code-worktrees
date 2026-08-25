import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importLib, importShared } from '../helpers/tslib.mjs'

const schema = await importShared('recipe-schema')
const { noteRecipe } = await importLib('lint')

const service = (over = {}) => ({
  name: 'web',
  cwd: '.',
  command: 'npm run dev -- --port {{port}}',
  portRange: [5200, 5299],
  ...over,
})

const recipe = (services) => ({
  worktreesDir: '.claude/worktrees',
  provision: { copy: [], link: [], write: [], postCreate: [], postRemove: [] },
  services,
  claude: { ownWorktreeCreation: false },
})

test('a service may declare itself the main one', () => {
  const parsed = schema.parseRecipe(recipe([service({ primary: true })]))

  assert.equal(parsed.ok, true)
  assert.equal(parsed.recipe.services[0].primary, true)
})

test('a recipe survives the round trip without inventing a primary', () => {
  const parsed = schema.parseRecipe(recipe([service()]))

  assert.equal(parsed.ok, true)
  assert.equal(parsed.recipe.services[0].primary, undefined)
})

test('two services cannot both be the main one', () => {
  const parsed = schema.parseRecipe(
    recipe([service({ primary: true }), service({ name: 'api', primary: true })]),
  )

  assert.equal(parsed.ok, false)

  const found = parsed.issues.filter((issue) => issue.path === 'services')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /`web`, `api`/)
})

test('one service needs no primary, so nothing is said about it', () => {
  const notes = noteRecipe(recipe([service()]))

  assert.deepEqual(
    notes.filter((note) => note.path === 'services'),
    [],
  )
})

test('several services with none marked says which one answers', () => {
  const notes = noteRecipe(recipe([service({ name: 'db' }), service()]))
  const found = notes.filter((note) => note.path === 'services')

  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'info')
  assert.match(found[0].message, /`db`/)
})

test('a marked primary settles it and the note goes away', () => {
  const notes = noteRecipe(recipe([service({ name: 'db' }), service({ primary: true })]))

  assert.deepEqual(
    notes.filter((note) => note.path === 'services'),
    [],
  )
})
