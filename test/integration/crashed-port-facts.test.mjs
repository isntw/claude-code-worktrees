import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { withHome } from '../helpers/home.mjs'
import { importLib } from '../helpers/tslib.mjs'

const worktrees = await importLib('worktrees')
const supervisor = await importLib('supervisor')

const trash = []
const open = []

after(async () => {
  await supervisor.stopAll()
  await Promise.all(open.map((server) => new Promise((done) => server.close(done))))
  for (const dir of trash) rmSync(dir, { recursive: true, force: true })
})

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
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

function hold(port) {
  return new Promise((done, fail) => {
    const server = createServer()
    open.push(server)
    server.once('error', fail)
    server.listen({ port }, () => done(server))
  })
}

function repo(port) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ccwt-crash-')))
  trash.push(dir)

  const root = join(dir, 'root')
  mkdirSync(root, { recursive: true })

  git(root, 'init', '--initial-branch', 'main')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', 'test')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'extensions.worktreeConfig', 'true')
  writeFileSync(join(root, 'README.md'), 'test\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'first')

  const worktree = join(dir, 'worktrees', 'feature')
  git(root, 'worktree', 'add', '-b', 'feature', worktree)
  git(worktree, 'config', '--worktree', 'ccwt.port.dev', String(port))

  return { root, worktree }
}

const projectFor = (root, port) => ({
  id: 'aaaaaaaaaaaa',
  name: 'crash-test',
  rootPath: root,
  addedAt: '2026-01-01T00:00:00.000Z',
  defaultBranch: 'main',
  recipe: {
    worktreesDir: '../worktrees',
    provision: { copy: [], link: [], write: [], postCreate: [], postRemove: [] },
    services: [
      { name: 'dev', cwd: '.', command: 'node -e process.exit(7)', portRange: [port, port] },
    ],
    claude: { ownWorktreeCreation: false },
  },
})

const devOf = (list, path) => {
  const worktree = list.find((entry) => entry.path === path)
  assert.ok(worktree, 'the worktree is in the listing')
  const dev = worktree.services.find((service) => service.name === 'dev')
  assert.ok(dev, 'the dev service is in the listing')
  return { worktree, dev }
}

async function settles(worktreeId, state, withinMs) {
  const deadline = Date.now() + withinMs

  while (Date.now() < deadline) {
    if (supervisor.status(worktreeId, 'dev')?.state === state) return true
    await new Promise((wait) => setTimeout(wait, 50))
  }

  return false
}

test('a service that crashed still reports who holds its pinned port', async () => {
  await withHome(async () => {
    const port = await spare()
    await hold(port)

    const { root, worktree } = repo(port)
    const project = projectFor(root, port)

    const before = devOf(await worktrees.list(project), worktree)

    assert.equal(before.dev.state, 'stopped')
    assert.equal(before.dev.port, port)
    assert.equal(before.dev.taken, true)
    assert.equal(before.dev.movable, false)

    await supervisor.start(before.worktree.id, worktree, project.recipe.services[0], port, {
      project: 'crash-test',
      port,
      ports: { dev: port },
      named: {},
      slug: 'feature',
      branch: 'feature',
      rootPath: root,
      worktreePath: worktree,
    })

    assert.equal(await settles(before.worktree.id, 'crashed', 10_000), true)

    const after = devOf(await worktrees.list(project), worktree)

    assert.equal(after.dev.state, 'crashed')
    assert.equal(after.dev.port, port)
    assert.equal(after.dev.taken, true)
    assert.equal(after.dev.movable, false)
    assert.equal(after.dev.heldBy, null)
  })
})
