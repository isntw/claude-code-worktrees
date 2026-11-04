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

after(async () => {
  await supervisor.stopAll()
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

function projectFor(low) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ccwt-resume-')))
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
    id: 'cccccccccccc',
    name: 'resume-test',
    rootPath: root,
    addedAt: '2026-01-01T00:00:00.000Z',
    defaultBranch: 'main',
    recipe: {
      worktreesDir: '../worktrees',
      provision: { copy: [], link: [], write: [], postCreate: [], postRemove: [] },
      services: [
        { name: 'dev', cwd: '.', command: `sh -c "node ${serve} {{port}}; true"`, portRange: [low, low + 20] },
      ],
      claude: { ownWorktreeCreation: false },
    },
  }
}

async function answers(port, withinMs) {
  const deadline = Date.now() + withinMs
  while (Date.now() < deadline) {
    if (await ports.isListening(port, 200)) return true
    await new Promise((wait) => setTimeout(wait, 50))
  }
  return false
}

async function quiet(port, withinMs) {
  const deadline = Date.now() + withinMs
  while (Date.now() < deadline) {
    if (!(await ports.isListening(port, 200))) return true
    await new Promise((wait) => setTimeout(wait, 50))
  }
  return false
}

test('a service stopped by hand is not resumed, one stopped by shutdown comes back on its port', async () => {
  await withHome(async () => {
    const project = projectFor(await spare())
    const made = await worktrees.create(project, { name: 'one', branch: '', start: false })

    const first = await worktrees.startService(project, made.id, made.path, 'dev', made.branch)
    assert.ok(await answers(first.port, 5000))
    await supervisor.stop(made.id, 'dev')
    assert.deepEqual(await supervisor.takeResumable(), [])

    const started = await worktrees.startService(project, made.id, made.path, 'dev', made.branch)
    assert.ok(await answers(started.port, 5000))

    await supervisor.stopAll()
    assert.ok(await quiet(started.port, 3000))

    await worktrees.resume([project])

    const back = supervisor.status(made.id, 'dev')
    assert.equal(back.port, started.port)
    assert.ok(await answers(started.port, 5000))

    await worktrees.resume([project])
    assert.equal(supervisor.status(made.id, 'dev').pid, back.pid)
    assert.ok(await answers(started.port, 1000))
  })
})
