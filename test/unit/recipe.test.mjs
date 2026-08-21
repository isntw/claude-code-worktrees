import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { dropHome, makeHome } from '../helpers/home.mjs'
import { importLib } from '../helpers/tslib.mjs'

const store = await importLib('store')
const projects = await importLib('projects')
const recipes = await importLib('recipe')
const { close } = await importLib('db')

const RECIPE = {
  worktreesDir: '.claude/worktrees',
  provision: { copy: [], link: ['node_modules'], write: [], postCreate: [], postRemove: [] },
  services: [{ name: 'dev', cwd: '.', command: 'serve --port {{port}}', portRange: [5200, 5299] }],
  claude: { ownWorktreeCreation: false },
}

async function withProject(work) {
  const home = makeHome()
  const root = mkdtempSync(join(tmpdir(), 'ccwt-repo-'))
  const previous = process.env.CCWT_HOME
  process.env.CCWT_HOME = home

  try {
    await store.addRecord({ id: 'one', rootPath: root, addedAt: 'now' })
    return await work(root)
  } finally {
    await close()
    if (previous === undefined) delete process.env.CCWT_HOME
    else process.env.CCWT_HOME = previous
    dropHome(home)
    rmSync(root, { recursive: true, force: true })
  }
}

test('a registered repository with nothing stored has no recipe at all', async () => {
  await withProject(async () => {
    const project = await projects.find('one')

    assert.equal(project.recipe, null)

    const missing = project.issues.find((issue) => issue.code === 'project.no-recipe')
    assert.ok(missing, 'a project with no recipe should say so')
    assert.equal(missing.severity, 'error')
    assert.equal(project.setup.headline, 'No recipe yet.')
  })
})

test('reading a recipe that was never written returns nothing to run, not a guess', async () => {
  await withProject(async () => {
    const project = await projects.find('one')
    const view = await recipes.readRecipe(project)

    assert.equal(view.source, 'none')
    assert.equal(view.recipe, null)
    assert.deepEqual(view.issues, [])

    const skeleton = JSON.parse(view.text)
    assert.deepEqual(skeleton.services, [])
    assert.deepEqual(skeleton.provision.link, [])
    assert.deepEqual(skeleton.provision.copy, [])
  })
})

test('a written recipe is what comes back, and forgetting it leaves none', async () => {
  await withProject(async () => {
    const project = await projects.find('one')

    const written = await recipes.writeRecipe(project, JSON.stringify(RECIPE))
    assert.equal(written.source, 'ccwt')
    assert.deepEqual(written.recipe.services[0].command, 'serve --port {{port}}')

    const after = await projects.find('one')
    assert.ok(!after.issues.some((issue) => issue.code === 'project.no-recipe'))

    const forgotten = await recipes.resetRecipe(after)
    assert.equal(forgotten.source, 'none')
    assert.equal(forgotten.recipe, null)
  })
})

test('a stored recipe that stopped validating is an error, never a suggestion', async () => {
  await withProject(async () => {
    await store.updateRecord('one', { recipe: { worktreesDir: 5 } })

    const project = await projects.find('one')
    assert.equal(project.recipe, null)
    assert.ok(project.issues.some((issue) => issue.code === 'project.recipe-invalid'))

    const view = await recipes.readRecipe(project)
    assert.equal(view.source, 'ccwt')
    assert.equal(view.recipe, null)
    assert.ok(view.issues.length > 0)
  })
})

test('a recipe whose service takes no port is reported, since nothing else checks', async () => {
  await withProject(async () => {
    const project = await projects.find('one')
    const blind = {
      ...RECIPE,
      services: [{ name: 'dev', cwd: '.', command: 'serve', portRange: [5200, 5299] }],
    }

    await recipes.writeRecipe(project, JSON.stringify(blind))
    const after = await projects.find('one')

    assert.ok(after.issues.some((issue) => issue.code === 'project.service-ignores-port'))

    const check = recipes.checkRecipe(JSON.stringify(blind))
    assert.equal(check.ok, true)
    assert.ok(check.notes.some((note) => note.path === 'services.0.command'))
  })
})
