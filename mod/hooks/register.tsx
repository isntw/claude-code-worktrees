import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LogLine, Pull, Service, View, Worktree } from '../types'
import { arrange, attention, chipText, chipsWidth, clean, owning, statusText, summary, tone, touchedPath, uptime, word } from './model'

const PANE = 'ccwt'
const TICK_MS = 3000
const RESCAN_MS = 60_000
const PULLS_MS = 60_000

const view = atom({ plugin: 'ccwt-mod', key: 'view' } as const, null)
const tracked = atom({ plugin: 'ccwt-mod', key: 'tracked' } as const, [])
const focus = atom({ plugin: 'ccwt-mod', key: 'focus' } as const, null)
const selected = atom({ plugin: 'ccwt-mod', key: 'selected' } as const, null)
const logs = atom({ plugin: 'ccwt-mod', key: 'logs' } as const, [])
const busy = atom({ plugin: 'ccwt-mod', key: 'busy' } as const, null)

type Here = Extract<View, { kind: 'here' }>
type Server = { origin: string; token: string; dashboard: string }
type Project = { id: string; name: string }
type Answer<T> = { data: T; error: null } | { data: null; error: string }

const address = (service: Service) => service.url ?? `http://localhost:${service.port}`

async function reach($: EngineInterface): Promise<Server | null> {
  const home = (await $.env.get('CCWT_HOME')) ?? `${await $.env.get('HOME')}/.ccwt`
  const raw = await $.fs.read(`${home}/runtime.json`).catch(() => null)
  if (typeof raw !== 'string') return null
  try {
    const runtime = JSON.parse(raw) as { port?: number; token?: string; host?: string }
    if (!runtime.port || typeof runtime.token !== 'string') return null
    const host = runtime.host === '::1' ? '[::1]' : (runtime.host ?? '127.0.0.1')
    return {
      origin: `http://${host}:${runtime.port}`,
      token: runtime.token,
      dashboard: `http://localhost:${runtime.port}`,
    }
  } catch {
    return null
  }
}

async function call<T>(
  $: EngineInterface,
  server: Server,
  path: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<Answer<T>> {
  const answered = await $.http
    .fetch(`${server.origin}${path}`, {
      method,
      headers: { 'x-ccwt-token': server.token, 'content-type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    })
    .catch(() => null)
  if (!answered) return { data: null, error: 'ccwt is not answering' }

  let body: unknown = null
  try {
    body = JSON.parse(answered.text)
  } catch {
    body = null
  }
  if (!answered.ok) {
    const message = body as { message?: string; statusMessage?: string } | null
    return { data: null, error: message?.message ?? message?.statusMessage ?? `HTTP ${answered.status}` }
  }
  return { data: body as T, error: null }
}

const local = {
  projectId: null as string | null,
  projectName: '',
  lastScan: 0,
  lastPulls: 0,
  pulls: {} as Record<string, Pull>,
  seen: false,
  ticking: false,
  lastView: '',
}

async function locate($: EngineInterface, server: Server, cwd: string) {
  if (local.projectId) {
    const listed = await call<Worktree[]>($, server, `/api/projects/${local.projectId}/worktrees`)
    const here = listed.data && owning(listed.data, cwd)
    if (listed.data && here) return { worktrees: listed.data, here }
    local.projectId = null
  }

  const now = Date.now()
  if (now - local.lastScan < RESCAN_MS) return null
  local.lastScan = now

  const projects = await call<Project[]>($, server, '/api/projects')
  for (const project of projects.data ?? []) {
    const listed = await call<Worktree[]>($, server, `/api/projects/${project.id}/worktrees`)
    const here = listed.data && owning(listed.data, cwd)
    if (listed.data && here) {
      local.projectId = project.id
      local.projectName = project.name
      local.lastPulls = 0
      return { worktrees: listed.data, here }
    }
  }
  return null
}

async function observe($: EngineInterface): Promise<{ next: View; server: Server | null }> {
  const server = await reach($)
  if (!server) return { next: { kind: 'offline' }, server }

  const found = await locate($, server, await $.session.cwd())
  if (!found) {
    const alive = await call<unknown>($, server, '/api/projects')
    return { next: alive.data ? { kind: 'outside' } : { kind: 'offline' }, server }
  }

  const { rows, others } = arrange(found.worktrees, found.here, await read($, tracked))

  const now = Date.now()
  if (now - local.lastPulls > PULLS_MS) {
    local.lastPulls = now
    const forge = await call<{ pulls: Record<string, Pull> }>($, server, `/api/projects/${local.projectId}/pulls`)
    local.pulls = forge.data?.pulls ?? {}
  }
  const pulls: Record<string, Pull> = {}
  for (const row of rows) {
    const pull = row.branch ? local.pulls[row.branch] : undefined
    if (pull) pulls[row.id] = pull
  }

  local.seen = true
  return {
    server,
    next: {
      kind: 'here',
      projectId: local.projectId!,
      projectName: local.projectName,
      dashboard: `${server.dashboard}/project/${local.projectId}`,
      hereId: found.here.id,
      rows,
      others,
      pulls,
    },
  }
}

async function tick($: EngineInterface) {
  if (local.ticking) return
  local.ticking = true
  try {
    const { next, server } = await observe($)

    const serialized = JSON.stringify(next)
    if (serialized !== local.lastView) {
      local.lastView = serialized
      await update($, view, () => next)
    }

    const isOpen = (await $.ui.panes()).some((pane) => pane.id === PANE)
    if (isOpen && server && next.kind === 'here') await refreshLogs($, server, next)
  } finally {
    local.ticking = false
  }
}

async function focused($: EngineInterface, current: Here): Promise<Worktree> {
  const wanted = await read($, focus)
  return current.rows.find((row) => row.id === wanted) ?? current.rows[0]!
}

async function refreshLogs($: EngineInterface, server: Server, current: Here) {
  const worktree = await focused($, current)
  const services = worktree.services
  let chosen = await read($, selected)
  if (!chosen || !services.some((service) => service.name === chosen)) {
    chosen = (services.find((service) => service.state === 'crashed') ?? services[0])?.name ?? null
    await update($, selected, () => chosen)
  }
  if (!chosen) {
    await update($, logs, () => [])
    return
  }

  const lines = await call<LogLine[]>($, server, `/api/projects/${current.projectId}/worktrees/${worktree.id}/logs`)
  const tail = (lines.data ?? []).filter((line) => line.service === chosen).slice(-80).map((line) => ({ ...line, text: clean(line.text) }))
  const before = await read($, logs)
  if (JSON.stringify(before) !== JSON.stringify(tail)) await update($, logs, () => tail)
}

async function remember($: EngineInterface, path: string) {
  await update($, tracked, (list) => (list.includes(path) ? list : [...list, path]))
  await tick($)
}

async function act($: EngineInterface, worktreeId: string, label: string, suffix: string) {
  const current = await read($, view)
  const server = await reach($)
  if (!server || current?.kind !== 'here') return

  const name = current.rows.find((row) => row.id === worktreeId)?.name ?? worktreeId
  await update($, busy, () => `${worktreeId} ${label}`)
  const done = await call<unknown>(
    $,
    server,
    `/api/projects/${current.projectId}/worktrees/${worktreeId}/${suffix}`,
    'POST',
  )
  await update($, busy, () => null)
  if (done.error) $.ui.toast(`ccwt: ${label} in ${name} failed: ${done.error}`)
  await tick($)
}

function startService($: EngineInterface, worktreeId: string, name: string) {
  return act($, worktreeId, `start ${name}`, `services/${encodeURIComponent(name)}/start`)
}

function stopService($: EngineInterface, worktreeId: string, name: string) {
  return act($, worktreeId, `stop ${name}`, `services/${encodeURIComponent(name)}/stop`)
}

function startAll($: EngineInterface, worktreeId: string) {
  return act($, worktreeId, 'start all', 'services/start')
}

function stopAll($: EngineInterface, worktreeId: string) {
  return act($, worktreeId, 'stop all', 'services/stop')
}

function repair($: EngineInterface, worktreeId: string) {
  return act($, worktreeId, 'repair', 'provision')
}

async function openPane($: EngineInterface, worktreeId?: string, service?: string) {
  if (worktreeId) await update($, focus, () => worktreeId)
  if (service) await update($, selected, () => service)
  await $.ui.open({ id: PANE, title: 'ccwt' })
  await tick($)
}

async function pick($: EngineInterface, worktreeId: string) {
  await update($, focus, () => worktreeId)
  await update($, selected, () => null)
  await update($, logs, () => [])
  await tick($)
}

async function choose($: EngineInterface, service: string) {
  await update($, selected, () => service)
  await tick($)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ccwt',
      description: "Show what ccwt runs for this session's worktrees: services, logs, the rest of the project",
    })
    $.ui.status(undefined)
    $.clock.every(TICK_MS, () => void tick($))
    void tick($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const path = touchedPath(e.tool, ran.text)
      if (path) await remember($, path)
    }
    return ran
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const text = statusText(await read($, view), local.seen)
    if (!text) return next(e)
    return next({ ...e, props: { ...e.props, tail: text } })
  })

  on('command.run', { command: 'ccwt' }, async ($) => {
    await openPane($)
    return { text: 'ccwt pane opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const current = await read($, view)
    if (current?.kind !== 'here') return next(e)

    const below = await next(e)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const working = await read($, busy)
    const alerts = attention(current)
    const many = current.rows.length > 1
    const nameWidth = Math.max(...current.rows.map((row) => row.name.length)) + 2
    const chipsColumn = Math.max(...current.rows.map((row) => chipsWidth(row.services)))
    const verbOf = (row: Worktree) => {
      const which = row.services.length === 1 ? row.services[0]!.name : 'all'
      const anyUp = row.services.some((one) => one.state === 'running' || one.state === 'starting')
      if (row.services.length === 0) return null
      return anyUp ? { kind: 'stop' as const, label: `stop ${which}` } : { kind: 'start' as const, label: `start ${which}` }
    }
    const actionColumn = Math.max(...current.rows.map((row) => (verbOf(row)?.label.length ?? 0) + 3))
    const claimed = new Set<string>()
    const hotkey = (key: string) => {
      if (claimed.has(key)) return undefined
      claimed.add(key)
      return key
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>
              ccwt . {current.projectName}
              {many ? ` . ${current.rows.length} worktrees this session` : ''}
            </Text>
            <Link href={current.dashboard} label="dashboard" />
          </Box>
          {current.rows.map((row, index) => {
            const verb = verbOf(row)
            const first = index === 0
            const isHere = row.id === current.hereId
            return (
              <Box key={`row-${row.id}`} flexDirection="row" gap={2}>
                <Box width={nameWidth} flexShrink={0}>
                  <Text bold={isHere} dimColor={!isHere} wrap="truncate">
                    {isHere && many ? '> ' : '  '}
                    {row.name}
                  </Text>
                </Box>
                <Box width={chipsColumn} flexShrink={0} flexDirection="row" gap={3}>
                  {row.services.length === 0 && <Text dimColor>no services</Text>}
                  {row.services.map((one) => {
                    const colour = tone(one)
                    return (
                      <Box key={`chip-${row.id}-${one.name}`} flexDirection="row" gap={1}>
                        <Text color={colour === 'dim' ? undefined : colour} dimColor={colour === 'dim'}>
                          {chipText(one)}
                        </Text>
                        {one.port !== null && <Link href={one.url ?? `http://localhost:${one.port}`} label={`localhost:${one.port}`} />}
                      </Box>
                    )
                  })}
                </Box>
                <Box width={actionColumn} flexShrink={0}>
                  {verb && (
                    <Button
                      key={`${verb.kind}-${row.id}`}
                      plain
                      label={working === `${row.id} ${verb.kind} all` ? `${verb.kind === 'start' ? 'starting' : 'stopping'}...` : verb.label}
                      hotkey={first ? hotkey(verb.kind === 'start' ? 's' : 'x') : undefined}
                      onPress={() => (verb.kind === 'start' ? startAll($, row.id) : stopAll($, row.id))}
                    />
                  )}
                </Box>
                <Button
                  key={`details-${row.id}`}
                  plain
                  dimColor
                  label="details"
                  hotkey={first ? hotkey('d') : undefined}
                  onPress={() => openPane($, row.id)}
                />
              </Box>
            )
          })}
          {alerts.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {alerts.map((alert) => (
                <Box key={alert.key} flexDirection="row" gap={2}>
                  <Text color={alert.tone}>
                    {alert.tone === 'error' || alert.tone === 'warning' ? '! ' : '~ '}
                    {alert.text}
                  </Text>
                  {alert.action?.kind === 'start' && alert.action.service && (
                    <Button
                      key={`${alert.key}-start`}
                      plain
                      label={working === `${alert.worktreeId} start ${alert.action.service}` ? 'starting...' : 'restart'}
                      hotkey={hotkey('r')}
                      onPress={() => startService($, alert.worktreeId, alert.action!.service!)}
                    />
                  )}
                  {alert.action?.kind === 'repair' && (
                    <Button
                      key={`${alert.key}-repair`}
                      plain
                      label={working === `${alert.worktreeId} repair` ? 'repairing...' : 'repair'}
                      hotkey={hotkey('p')}
                      onPress={() => repair($, alert.worktreeId)}
                    />
                  )}
                  {alert.logs && (
                    <Button
                      key={`${alert.key}-logs`}
                      plain
                      dimColor
                      label="logs"
                      hotkey={hotkey('l')}
                      onPress={() => openPane($, alert.worktreeId, alert.logs)}
                    />
                  )}
                  {alert.link && <Link href={alert.link} label="open" />}
                </Box>
              ))}
            </Box>
          )}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const current = await read($, view)

    if (!current || current.kind === 'offline') {
      return <Text dimColor>ccwt is not running. Start it with `ccwt start`.</Text>
    }
    if (current.kind === 'outside') {
      return <Text dimColor>This session is not inside a worktree of a project ccwt knows.</Text>
    }

    const worktree = await focused($, current)
    const chosen = await read($, selected)
    const tail = await read($, logs)
    const working = await read($, busy)
    const now = Date.now()
    const service = worktree.services.find((one) => one.name === chosen) ?? null
    const pull = current.pulls[worktree.id]
    const many = current.rows.length > 1
    const fixedRows =
      10 + worktree.services.length + (many ? current.rows.length + 2 : 0) + Math.min(current.others.length, 8)
    const room = Math.max(3, (e.viewport?.rows ?? 30) - fixedRows)
    const busyAs = (label: string) => working === `${worktree.id} ${label}`

    return (
      <Box flexDirection="column" gap={1}>
        {many && (
          <Box flexDirection="column">
            <Text dimColor>THIS SESSION</Text>
            {current.rows.map((row) => (
              <Box key={`pick-${row.id}`} flexDirection="row" gap={2}>
                <Button
                  key={`pick-${row.id}`}
                  plain
                  dimColor={row.id !== worktree.id}
                  label={`${row.id === worktree.id ? '>' : ' '} ${row.name}${row.id === current.hereId ? ' (here)' : ''}`}
                  onPress={() => pick($, row.id)}
                />
                <Text dimColor wrap="truncate">
                  {summary(row)}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          <Text bold>
            {current.projectName} / {worktree.name}
          </Text>
          <Text dimColor wrap="truncate">
            {worktree.branch ?? 'detached'}
            {pull ? `   PR #${pull.number} ${pull.state}` : ''}
            {worktree.locked ? `   locked${worktree.lockReason ? `: ${worktree.lockReason}` : ''}` : ''}
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text dimColor>SERVICES</Text>
          {worktree.services.length === 0 && <Text dimColor>The recipe declares no services.</Text>}
          {worktree.services.map((one) => {
            const colour = tone(one)
            return (
              <Box key={`svc-${one.name}`} flexDirection="row" gap={2}>
                <Button
                  key={`select-${one.name}`}
                  plain
                  dimColor={one.name !== chosen}
                  label={`${one.name === chosen ? '>' : ' '} ${one.name}`}
                  onPress={() => choose($, one.name)}
                />
                <Text color={colour === 'dim' ? undefined : colour} dimColor={colour === 'dim'}>
                  {word(one)}
                </Text>
                {one.port !== null && <Link href={address(one)} label={`localhost:${one.port}`} />}
                <Text dimColor>
                  {one.state === 'running' ? `up ${uptime(one.startedAt, now)}` : ''}
                  {one.state === 'crashed' && one.exitCode !== null ? `exit ${one.exitCode}` : ''}
                </Text>
              </Box>
            )
          })}
          <Box flexDirection="row" gap={2} marginTop={1}>
            {service && service.state !== 'running' && service.state !== 'starting' && (
              <Button
                key="start"
                label={busyAs(`start ${service.name}`) ? 'starting...' : `start ${service.name}`}
                hotkey="s"
                onPress={() => startService($, worktree.id, service.name)}
              />
            )}
            {service && (service.state === 'running' || service.state === 'starting') && (
              <Button
                key="stop"
                label={busyAs(`stop ${service.name}`) ? 'stopping...' : `stop ${service.name}`}
                hotkey="s"
                onPress={() => stopService($, worktree.id, service.name)}
              />
            )}
            {!worktree.provisioned && !worktree.repairing && (
              <Button
                key="repair"
                label={busyAs('repair') ? 'repairing...' : 'repair'}
                hotkey="p"
                onPress={() => repair($, worktree.id)}
              />
            )}
            <Link href={current.dashboard} label="dashboard" />
          </Box>
        </Box>

        {service && (
          <Box flexDirection="column">
            <Text dimColor>LOGS . {service.name}</Text>
            {tail.length === 0 && <Text dimColor>Nothing printed yet.</Text>}
            {tail.slice(-room).map((line, index) => (
              <Text key={`log-${index}`} wrap="truncate" color={line.stream === 'stderr' ? 'error' : undefined}>
                {clean(line.text)}
              </Text>
            ))}
          </Box>
        )}

        {current.others.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>REST OF THE PROJECT</Text>
            {current.others.slice(0, 8).map((other) => (
              <Box key={`wt-${other.id}`} flexDirection="row" gap={2}>
                <Text wrap="truncate">{other.name}</Text>
                <Text dimColor wrap="truncate">
                  {summary(other)}
                </Text>
                {(other.origin === 'claude' || other.locked) && <Text color="claude">agent</Text>}
              </Box>
            ))}
            {current.others.length > 8 && <Text dimColor>and {current.others.length - 8} more</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
