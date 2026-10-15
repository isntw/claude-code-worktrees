import { expect, test } from 'claude-code/testing'

import type { Pull, Service, View, Worktree } from '../types'
import { arrange, attention, clean, bornInSession, contest, fit, mainService, owning, provision, statusText, touchedPath, touchedPathIn } from './model'

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
  holders: {},
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

test('the main service is the primary one, else the first', () => {
  const vite = service({ name: 'vite', port: 5237 })
  const serve = service({ name: 'serve', port: 20086, primary: true })
  expect(mainService(worktree({ services: [vite, serve] }))?.name).toBe('serve')
  expect(mainService(worktree({ services: [vite] }))?.name).toBe('vite')
  expect(mainService(worktree({ services: [] }))).toBe(undefined)
})


test('a pinned port held by a stray process is raised once, naming it, with a take over for its worktree', () => {
  const pinned = (id: string, path: string) =>
    worktree({ id, name: id, path, services: [service({ name: 'dev', port: 3000, state: 'stopped', taken: true })] })
  const view: View = {
    ...(here([pinned('root', '/repo'), pinned('a', '/repo/.claude/worktrees/a'), pinned('b', '/repo/.claude/worktrees/b')]) as Extract<View, { kind: 'here' }>),
    holders: {
      '3000': { port: 3000, free: false, ours: [], foreign: [{ pid: 95422, name: 'next-server', cwd: '/repo' }] },
    },
  }
  const alerts = attention(view)
  expect(alerts.length).toBe(1)
  expect(alerts[0]?.text).toBe('port 3000 is held by next-server (pid 95422) in repo, not started by ccwt')
  expect(alerts[0]?.worktreeId).toBe('root')
  expect(contest(view.rows[1]!, view.holders)).toEqual({
    port: 3000,
    holder: 'next-server (pid 95422) in repo, not started by ccwt',
    pids: [95422],
    services: [],
  })
})

test('a pinned port another worktree runs offers run here, stopping that service, and raises no alert', () => {
  const held = worktree({
    id: 'a',
    services: [
      service({
        name: 'dev',
        port: 3000,
        state: 'stopped',
        taken: true,
        heldBy: { worktreeId: 'b', worktree: 'mtech-6080', service: 'dev', same: true },
      }),
    ],
  })
  expect(contest(held, {})).toEqual({
    port: 3000,
    holder: 'dev in mtech-6080',
    pids: [],
    services: [{ worktreeId: 'b', service: 'dev' }],
  })
  expect(attention(here([held]))).toEqual([])
})

test('a movable or running service is never contested', () => {
  const movable = worktree({ services: [service({ port: 5237, state: 'stopped', taken: true, movable: true })] })
  const running = worktree({ services: [service({ port: 5237, state: 'running', taken: true })] })
  expect(contest(movable, {})).toBe(null)
  expect(contest(running, {})).toBe(null)
})

test('a worktree created after the session started is the session\'s, the root and unknown ones never', () => {
  const started = Date.parse('2026-10-13T15:30:00Z')
  expect(bornInSession(worktree({}), Date.parse('2026-10-13T15:45:47Z'), started)).toBe(true)
  expect(bornInSession(worktree({}), Date.parse('2026-10-13T09:00:00Z'), started)).toBe(false)
  expect(bornInSession(worktree({}), null, started)).toBe(false)
  expect(bornInSession(worktree({ root: true }), Date.parse('2026-10-13T15:45:47Z'), started)).toBe(false)
})

test('the path is also found in a tool result whose text is prose', () => {
  const ran = { text: 'Created x. It is provisioned and stopped.', result: { structuredContent: { ok: true, path: '/repo/x' } } }
  expect(touchedPathIn('mcp__plugin_ccwt_ccwt__ccwt_create_worktree', ran)).toBe('/repo/x')
})

test('a long name is cut in the middle to the room it has, keeping both ends', () => {
  expect(fit('mtech-6080-payment-methods-design-fixes', 50)).toBe('mtech-6080-payment-methods-design-fixes')
  expect(fit('mtech-6080-payment-methods-design-fixes', 24)).toBe('mtech-6080-...sign-fixes')
  expect(fit('mtech-6080-payment-methods-design-fixes', 24).length).toBe(24)
  expect(fit('abcdef', 3)).toBe('abc')
})

test('the provision column says ok, repairing or missing', () => {
  expect(provision(worktree({}))).toEqual({ text: 'ok', tone: 'dim' })
  expect(provision(worktree({ provisioned: false }))).toEqual({ text: 'missing', tone: 'warning' })
  expect(provision(worktree({ provisioned: false, repairing: { label: 'node_modules', done: 1, total: 3 } }))).toEqual({ text: 'repairing', tone: 'warning' })
})
