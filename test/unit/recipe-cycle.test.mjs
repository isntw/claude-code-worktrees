import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importLib, importShared, sourceOf } from '../helpers/tslib.mjs'

const schema = await importShared('recipe-schema')
const recipes = await importLib('recipe')

const LOOP = {
  worktreesDir: '.claude/worktrees',
  provision: { copy: [], link: [], write: [], postCreate: [], postRemove: [] },
  services: [
    {
      name: 'api',
      cwd: '.',
      command: 'a --port {{port}}',
      portRange: [5200, 5299],
      dependsOn: ['web'],
    },
    {
      name: 'web',
      cwd: '.',
      command: 'a --port {{port}}',
      portRange: [5200, 5299],
      dependsOn: ['api'],
    },
  ],
  claude: { ownWorktreeCreation: false },
}

function loopIssue(issues) {
  const found = issues.filter((issue) => issue.cycle)
  assert.equal(found.length, 1, 'exactly one issue should carry a cycle')
  return found[0]
}

test('a dependsOn loop reports the chain as data, not only as prose', () => {
  const parsed = schema.parseRecipe(LOOP)

  assert.equal(parsed.ok, false)

  const issue = loopIssue(parsed.issues)

  assert.equal(issue.path, 'services')
  assert.deepEqual(issue.cycle, ['api', 'web', 'api'])
})

test('the prose the loop prints is unchanged, so the chain stays quotable', () => {
  const issue = loopIssue(schema.parseRecipe(LOOP).issues)

  assert.equal(issue.message, 'These services depend on each other in a loop: api → web → api.')
  assert.equal(issue.cycle.join(' → '), 'api → web → api')
})

test('a longer loop carries every service in it, first name repeated at the end', () => {
  const three = {
    ...LOOP,
    services: ['one', 'two', 'three'].map((name, index) => ({
      name,
      cwd: '.',
      command: 'a --port {{port}}',
      portRange: [5200, 5299],
      dependsOn: [['two', 'three', 'one'][index]],
    })),
  }

  const issue = loopIssue(schema.parseRecipe(three).issues)

  assert.deepEqual(issue.cycle, ['one', 'two', 'three', 'one'])
  assert.equal(
    issue.message,
    'These services depend on each other in a loop: one → two → three → one.',
  )
})

test('every other issue carries no cycle at all, so the field means one thing', () => {
  const ambiguous = {
    ...LOOP,
    services: [
      {
        name: 'api',
        cwd: '.',
        command: 'a --port {{port}}',
        portRange: [5200, 5299],
        ports: { api: [6000, 6000] },
      },
    ],
  }

  const parsed = schema.parseRecipe(ambiguous)

  assert.equal(parsed.ok, false)
  assert.ok(parsed.issues.length > 0)

  for (const issue of parsed.issues) {
    assert.equal(issue.cycle, undefined, `${issue.path} should carry no cycle`)
  }
})

test('a service depending on itself is a loop of one, reported alongside its own complaint', () => {
  const itself = {
    ...LOOP,
    services: [
      {
        name: 'api',
        cwd: '.',
        command: 'a --port {{port}}',
        portRange: [5200, 5299],
        dependsOn: ['api'],
      },
    ],
  }

  const parsed = schema.parseRecipe(itself)

  assert.deepEqual(loopIssue(parsed.issues).cycle, ['api', 'api'])
  assert.ok(parsed.issues.some((issue) => issue.message === '`api` cannot depend on itself.'))
})

test('text that is not JSON carries no cycle', () => {
  const parsed = schema.parseRecipeText('{ not json')

  assert.equal(parsed.ok, false)
  for (const issue of parsed.issues) {
    assert.equal(issue.cycle, undefined)
  }
})

test('checkRecipe hands the cycle through to whatever asked it to validate', () => {
  const check = recipes.checkRecipe(JSON.stringify(LOOP))

  assert.equal(check.ok, false)

  const issue = loopIssue(check.issues)
  assert.deepEqual(issue.cycle, ['api', 'web', 'api'])
  assert.equal(issue.message, 'These services depend on each other in a loop: api → web → api.')
})

test('the MCP issue shape declares the cycle, so a client sees it in the output schema', () => {
  const answer = sourceOf('plugin/src/mcp/answer.ts')

  assert.match(answer, /export const ISSUE = z\.object\(\{[\s\S]*?cycle: z[\s\S]*?\}\)/)
  assert.match(answer, /\.array\(z\.string\(\)\)\s*\.optional\(\)/)
})
