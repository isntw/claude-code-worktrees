import { expect, test } from 'claude-code/testing'

import type { Pull, Service, View, Worktree } from '../types'
import { arrange, attention, clean, owning, statusText, touchedPath } from './model'

const service = (over: Partial<Service>): Service => ({
  name: 'web',
  state: 'running',
  port: 5601,
  url: 'http://localhost:5601',
  startedAt: null,
  exitCode: null,
  reachable: true,
  ...over,
})

const worktree = (over: Partial<Worktree>): Worktree => ({
  id: 'w1',
  name: 'feat-login',
  path: '/repo/.claude/worktrees/feat-login',
  root: false,
  branch: 'feat-login',
  origin: 'ccwt',
  locked: false,
  lockReason: null,
  provisioned: true,
  repairing: null,
  services: [],
  issues: [],
  ...over,
})

const here = (rows: Worktree[], pulls: Record<string, Pull> = {}): View => ({
  kind: 'here',
  projectId: 'p1',
  projectName: 'repo',
  dashboard: 'http://localhost:5600/project/p1',
  hereId: rows[0]!.id,
  rows,
  others: [],
  pulls,
})

test('status line lists each service of the current worktree with its port and state', () => {
  const view = here([worktree({ services: [service({}), service({ name: 'api', port: 5602, state: 'crashed' })] })])
  expect(statusText(view, true)).toBe('ccwt  feat-login  web :5601 up  api :5602 crashed')
})

test('status line counts the session worktrees beyond the current one', () => {
  const view = here([worktree({}), worktree({ id: 'w2', name: 'other' })])
  expect(statusText(view, true)).toBe('ccwt  feat-login  +1 more')
})

test('offline is only said once a project was seen', () => {
  expect(statusText({ kind: 'offline' }, false)).toBe(undefined)
  expect(statusText({ kind: 'offline' }, true)).toBe('ccwt offline')
  expect(statusText({ kind: 'outside' }, true)).toBe(undefined)
})

test('a healthy worktree raises nothing', () => {
  expect(attention(here([worktree({ services: [service({})] })]))).toEqual([])
})

test('crashed, unprovisioned and merged each raise one alert', () => {
  const view = here(
    [worktree({ provisioned: false, services: [service({ name: 'api', state: 'crashed', exitCode: 1 })] })],
    { w1: { number: 57, title: 't', url: 'https://x/57', state: 'merged' } },
  )
  expect(attention(view).map((alert) => alert.key)).toEqual(['w1-crashed-api', 'w1-unprovisioned', 'w1-merged'])
})

test('with several rows an alert names its worktree and carries its id', () => {
  const view = here([worktree({}), worktree({ id: 'w2', name: 'other', services: [service({ state: 'crashed' })] })])
  const [alert] = attention(view)
  expect(alert?.text).toBe('other: web crashed')
  expect(alert?.worktreeId).toBe('w2')
})

test('a repair in progress replaces the unprovisioned alert', () => {
  const view = here([worktree({ provisioned: false, repairing: { label: 'copying .env', done: 3, total: 7 } })])
  expect(attention(view).map((alert) => alert.text)).toEqual(['repairing: copying .env  3/7'])
})

test('rows are the current worktree, then the tracked ones in order, the rest apart', () => {
  const root = worktree({ id: 'r', name: 'root', path: '/repo', root: true })
  const a = worktree({ id: 'a', path: '/repo/a' })
  const b = worktree({ id: 'b', path: '/repo/b' })
  const c = worktree({ id: 'c', path: '/repo/c' })
  const { rows, others } = arrange([root, a, b, c], root, ['/repo/b', '/gone', '/repo/a', '/repo'])
  expect(rows.map((row) => row.id)).toEqual(['r', 'b', 'a'])
  expect(others.map((row) => row.id)).toEqual(['c'])
})

test('the path is read from a ccwt worktree tool result and nothing else', () => {
  const text = '{"ok":true,"created":true,"path":"/repo/.claude/worktrees/x","branch":"x"}'
  expect(touchedPath('mcp__plugin_ccwt_ccwt__ccwt_create_worktree', text)).toBe('/repo/.claude/worktrees/x')
  expect(touchedPath('mcp__plugin_ccwt_ccwt__ccwt_start_worktree', `started\n${text}`)).toBe('/repo/.claude/worktrees/x')
  expect(touchedPath('mcp__plugin_ccwt_ccwt__ccwt_get_status', text)).toBe(null)
  expect(touchedPath('Bash', text)).toBe(null)
})

test('the deepest worktree containing the cwd owns it', () => {
  const root = worktree({ id: 'r', path: '/repo', root: true })
  const nested = worktree({ id: 'n', path: '/repo/.claude/worktrees/x' })
  expect(owning([root, nested], '/repo/.claude/worktrees/x/src')?.id).toBe('n')
  expect(owning([root, nested], '/repo/src')?.id).toBe('r')
  expect(owning([root, nested], '/elsewhere')).toBe(null)
})

test('log text loses terminal colour codes and control characters', () => {
  const raw = '\x1b[32m  Local:   \x1b[39m \x1b[36m\x1b[4mhttp://127.0.0.1:\x1b[1m5288\x1b[22m/\x1b[24m\x1b[39m\tok\x07'
  expect(clean(raw)).toBe('  Local:    http://127.0.0.1:5288/  ok')
})

test('a finished repair raises nothing', () => {
  const view = here([worktree({ repairing: { label: 'linking node_modules', done: 3740, total: 3740 } })])
  expect(attention(view)).toEqual([])
})
