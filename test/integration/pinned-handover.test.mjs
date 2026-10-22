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
const ports = await importLib('ports')

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

function projectFor(port) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ccwt-pinned-')))
  trash.push(dir)

  const root = join(dir, 'root')
  mkdirSync(root, { recursive: true })

  git(root, 'init', '--initial-branch', 'main')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', 'test')
  git(root, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, 'README.md'), 'test\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'first')

  const serve = join(dir, 'serve.js')
  writeFileSync(serve, "require('net').createServer().listen(Number(process.argv[2]))\n")

  return {
    id: 'bbbbbbbbbbbb',
    name: 'pinned-test',
    rootPath: root,
    addedAt: '2026-01-01T00:00:00.000Z',
    defaultBranch: 'main',
    recipe: {
      worktreesDir: '../worktrees',
      provision: { copy: [], link: [], write: [], postCreate: [], postRemove: [] },
      services: [
        { name: 'dev', cwd: '.', command: `node ${serve} {{port}}`, portRange: [port, port] },
      ],
      claude: { ownWorktreeCreation: false },
    },
  }
}

const devOf = (worktree) => worktree.services.find((service) => service.name === 'dev')

async function answers(port, withinMs) {
  const deadline = Date.now() + withinMs
  while (Date.now() < deadline) {
    if (await ports.isListening(port, 200)) return true
    await new Promise((wait) => setTimeout(wait, 50))
  }
  return false
}

test('a worktree whose pinned port is busy is still created, and a retry returns it', async () => {
  await withHome(async () => {
    const port = await spare()
    await hold(port)
    const project = projectFor(port)

    const made = await worktrees.create(project, { name: 'one', branch: '', start: false })

    assert.equal(devOf(made).state, 'stopped')
    assert.equal(devOf(made).port, port)
    assert.equal(devOf(made).taken, true)

    const again = await worktrees.create(project, { name: 'one', branch: '', start: false })
    assert.equal(again.id, made.id)
    assert.equal(devOf(again).port, port)

    await assert.rejects(
      worktrees.create(project, { name: 'one', branch: 'other', start: false }),
      /already exists/,
    )
  })
})

test('starting on a pinned port held by something ccwt does not run is refused by pid', async () => {
  await withHome(async () => {
    const port = await spare()
    await hold(port)
    const project = projectFor(port)

    const made = await worktrees.create(project, { name: 'one', branch: '', start: false })

    await assert.rejects(
      worktrees.startService(project, made.id, made.path, 'dev', made.branch),
      /takeOver/,
    )
    await assert.rejects(
      worktrees.startService(project, made.id, made.path, 'dev', made.branch, true, true),
      new RegExp(`pid ${process.pid} .*which ccwt does not run`),
    )
  })
})

test('takeOver stops the sibling holding the pinned port and starts here', async () => {
  await withHome(async () => {
    const port = await spare()
    const project = projectFor(port)

    const a = await worktrees.create(project, { name: 'a', branch: '', start: false })
    const b = await worktrees.create(project, { name: 'b', branch: '', start: false })

    await worktrees.startService(project, a.id, a.path, 'dev', a.branch)
    assert.equal(await answers(port, 10_000), true)

    const started = await worktrees.startService(project, b.id, b.path, 'dev', b.branch, true, true)

    assert.deepEqual(
      started.tookOver.map(({ worktree, service }) => ({ worktree, service })),
      [{ worktree: 'a', service: 'dev' }],
    )
    assert.equal(supervisor.status(a.id, 'dev').state, 'stopped')
    assert.equal(supervisor.holding(port)[0]?.worktreeId, b.id)
  })
})
