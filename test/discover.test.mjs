import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  duplicates,
  encodedName,
  parseWorktrees,
  portKey,
  shapeOf,
  targetOf,
  underTranscript,
} from '../plugin/lib/discover.mjs'

test('a port key never contains an underscore', () => {
  assert.equal(portKey('dev'), 'ccwt.port.dev')
  assert.equal(portKey('api_server'), 'ccwt.port.api-server')
  assert.equal(portKey('Web UI'), 'ccwt.port.web-ui')
  assert.equal(portKey('__weird__'), 'ccwt.port.weird')
  assert.equal(portKey('a.b.c'), 'ccwt.port.a-b-c')
})

test('a command shape drops flags and the port template', () => {
  assert.deepEqual(shapeOf('npm run dev -- --port {{port}}'), ['npm', 'run', 'dev'])
  assert.deepEqual(shapeOf('bin/rails server -p {{port}}'), ['bin/rails', 'server'])
  assert.deepEqual(shapeOf('docker compose -f compose.ccwt.yml --project-directory . up'), [
    'docker',
    'compose',
    'compose.ccwt.yml',
    '.',
    'up',
  ])
})

test('the guard matches a declared command wherever it sits', () => {
  const declared = 'npm run dev -- --port {{port}}'

  assert.ok(duplicates('npm run dev', declared))
  assert.ok(duplicates('npm run dev -- --port 5270', declared))
  assert.ok(duplicates('cd /somewhere && npm run dev', declared))
  assert.ok(duplicates('NODE_ENV=development npm run dev', declared))
  assert.ok(duplicates('nohup npm run dev &', declared))
})

test('a mention inside a quoted argument is text, not a command', () => {
  const declared = 'npm run dev -- --port {{port}}'
  const deep = 'a dashboard run through npm run dev writes no file'

  assert.equal(duplicates(`git commit -m "${deep}"`, declared), false)
  assert.equal(duplicates(`git commit -m '${deep}'`, declared), false)
  assert.equal(duplicates('gh pr create --body "start it with npm run dev"', declared), false)
})

test('a match must sit where a command would, not anywhere in the line', () => {
  const declared = 'npm run dev -- --port {{port}}'

  assert.equal(duplicates('echo hello npm run dev world', declared), false)
  assert.equal(duplicates('grep -r npm run dev src', declared), false)
})

test('the guard leaves everything else alone', () => {
  const declared = 'npm run dev -- --port {{port}}'

  assert.equal(duplicates('npm run build', declared), false)
  assert.equal(duplicates('npm run typecheck', declared), false)
  assert.equal(duplicates('npm test', declared), false)
  assert.equal(duplicates('git commit -m "npm run dev"', declared), false)
  assert.equal(duplicates('ls -la', declared), false)
})

test('a one-word service command never matches, since it would catch too much', () => {
  assert.equal(duplicates('npm run dev', 'npm'), false)
  assert.equal(duplicates('make', 'make'), false)
})

test('a docker recipe guards its own shape and not another project’s', () => {
  const declared = 'docker compose -f compose.ccwt.yml --project-directory . up'

  assert.ok(duplicates('docker compose -f compose.ccwt.yml --project-directory . up', declared))
  assert.equal(duplicates('npm run dev', declared), false)
})

test('a leading cd redirects the guard to the right worktree', () => {
  assert.equal(targetOf('npm run dev', '/repo'), '/repo')
  assert.equal(targetOf('cd /elsewhere && npm run dev', '/repo'), '/elsewhere')
  assert.equal(targetOf('cd sub/tree && npm run dev', '/repo'), '/repo/sub/tree')
  assert.equal(targetOf('cd "with space" && npm run dev', '/repo'), '/repo/with space')
  assert.equal(targetOf("cd 'quoted' ; npm run dev", '/repo'), '/repo/quoted')
})

test('a cd that is not a prefix does not move the target', () => {
  assert.equal(targetOf('echo cd /elsewhere && npm run dev', '/repo'), '/repo')
})

test('worktree parsing keeps the main worktree first and drops a bare one', () => {
  const porcelain = [
    'worktree /repo',
    'HEAD abc',
    'branch refs/heads/main',
    '',
    'worktree /repo/.claude/worktrees/feature',
    'HEAD def',
    'branch refs/heads/worktree-feature',
    '',
  ].join('\n')

  assert.deepEqual(parseWorktrees(porcelain), ['/repo', '/repo/.claude/worktrees/feature'])
})

test('a bare worktree is not reported', () => {
  const porcelain = ['worktree /repo.git', 'bare', '', 'worktree /repo', 'HEAD abc', ''].join('\n')

  assert.deepEqual(parseWorktrees(porcelain), ['/repo'])
})

test('nothing at all parses to nothing', () => {
  assert.deepEqual(parseWorktrees(''), [])
})

test('a transcript directory encodes the worktree it belongs to', () => {
  assert.equal(
    encodedName('/Users/someone/work/repo/.claude/worktrees/a-feature'),
    '-Users-someone-work-repo--claude-worktrees-a-feature',
  )
  assert.equal(encodedName('/Users/some.one/kp_xv_portal'), '-Users-some-one-kp-xv-portal')
})

test('the session is found from its transcript, not from where it was launched', () => {
  const paths = ['/repo', '/repo/.claude/worktrees/first', '/repo/.claude/worktrees/second']
  const transcript =
    '/home/me/.claude/projects/-repo--claude-worktrees-second/abc-123.jsonl'

  assert.equal(underTranscript(paths, transcript), '/repo/.claude/worktrees/second')
})

test('the root is recognised as much as a worktree is', () => {
  const paths = ['/repo', '/repo/.claude/worktrees/first']

  assert.equal(underTranscript(paths, '/home/me/.claude/projects/-repo/abc.jsonl'), '/repo')
})

test('a transcript ccwt cannot place resolves to nothing, never to a guess', () => {
  const paths = ['/repo', '/repo/.claude/worktrees/first']

  assert.equal(underTranscript(paths, '/home/me/.claude/projects/-somewhere-else/abc.jsonl'), null)
  assert.equal(underTranscript(paths, ''), null)
  assert.equal(underTranscript(paths, undefined), null)
})

test('neither cwd nor the transcript is trusted alone — a worktree wins over the root', () => {
  const paths = ['/repo', '/repo/.claude/worktrees/feature']
  const inWorktree = '/home/me/.claude/projects/-repo--claude-worktrees-feature/s.jsonl'
  const inRoot = '/home/me/.claude/projects/-repo/s.jsonl'

  assert.equal(underTranscript(paths, inWorktree), '/repo/.claude/worktrees/feature')
  assert.equal(underTranscript(paths, inRoot), '/repo')
})
