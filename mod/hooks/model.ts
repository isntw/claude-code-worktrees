import type { Holder, Service, View, Worktree } from '../types'

export type Tone = 'error' | 'warning' | 'suggestion' | 'merged'

export type Alert = {
  key: string
  tone: Tone
  text: string
  worktreeId: string
  action?: { kind: 'start' | 'repair'; service?: string }
  takeover?: { port: number; service: string; pids: number[]; services: { worktreeId: string; service: string }[] }
  logs?: string
  link?: string
}

type Here = Extract<View, { kind: 'here' }>

export function word(service: Service): string {
  if (service.state === 'running') return service.reachable === false ? 'unreachable' : 'up'
  return service.state
}

export function tone(service: Service): Tone | 'dim' | 'success' {
  if (service.state === 'crashed') return 'error'
  if (service.state === 'starting') return 'warning'
  if (service.state === 'running') return service.reachable === false ? 'warning' : 'success'
  return 'dim'
}

export function current(view: Here): Worktree | null {
  return view.rows.find((row) => row.id === view.hereId) ?? null
}

export function statusText(view: View | null, seen: boolean): string | undefined {
  if (!view) return undefined
  if (view.kind === 'offline') return seen ? 'ccwt offline' : undefined
  if (view.kind === 'outside') return undefined

  const here = current(view)
  if (!here) return undefined
  const parts = here.services.map((service) =>
    service.port === null
      ? `${service.name} ${word(service)}`
      : `${service.name} :${service.port} ${word(service)}`,
  )
  const more = view.rows.length > 1 ? [`+${view.rows.length - 1} more`] : []
  return ['ccwt', here.name, ...parts, ...more].join('  ')
}

export function attention(view: View | null): Alert[] {
  if (!view || view.kind !== 'here') return []
  const many = view.rows.length > 1
  return [...view.rows.flatMap((row) => alertsFor(row, view, many ? `${row.name}: ` : '')), ...heldPorts(view)]
}

function base(path: string | null): string {
  if (!path) return 'somewhere'
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function holderText(holder: Holder): string {
  const foreign = holder.foreign[0]
  if (foreign) return `${foreign.name} (pid ${foreign.pid}) in ${base(foreign.cwd)}, not started by ccwt`
  const ours = holder.ours[0]
  if (ours) return `${ours.worktree}'s ${ours.service}`
  return 'something else'
}

function heldPorts(view: Here): Alert[] {
  const alerts: Alert[] = []
  const seen = new Set<number>()

  for (const row of view.rows) {
    const main = mainService(row)
    if (!main || main.port === null || !main.taken || main.state === 'running' || seen.has(main.port)) continue
    seen.add(main.port)

    const holder = view.holders[String(main.port)]
    const cwd = holder?.foreign[0]?.cwd ?? null
    const owner =
      view.rows
        .filter((candidate) => cwd !== null && (cwd === candidate.path || cwd.startsWith(`${candidate.path}/`)))
        .sort((a, b) => b.path.length - a.path.length)[0] ??
      view.rows.find((candidate) => candidate.id === view.hereId && mainService(candidate)?.port === main.port) ??
      row
    const service = mainService(owner)?.name ?? main.name

    alerts.push({
      key: `port-${main.port}`,
      tone: 'warning',
      worktreeId: owner.id,
      text: `port ${main.port} is held by ${holder ? holderText(holder) : 'something else'}`,
      takeover: holder
        ? {
            port: main.port,
            service,
            pids: holder.foreign.map((one) => one.pid),
            services: holder.ours.map((one) => ({ worktreeId: one.worktreeId, service: one.service })),
          }
        : undefined,
    })
  }

  return alerts
}

function alertsFor(row: Worktree, view: Here, prefix: string): Alert[] {
  const alerts: Alert[] = []
  const own = { worktreeId: row.id }

  for (const service of row.services) {
    if (service.state === 'crashed') {
      alerts.push({
        ...own,
        key: `${row.id}-crashed-${service.name}`,
        tone: 'error',
        text: `${prefix}${service.name} crashed${service.exitCode === null ? '' : ` (exit ${service.exitCode})`}`,
        action: { kind: 'start', service: service.name },
        logs: service.name,
      })
    }
  }

  if (row.repairing && row.repairing.done < row.repairing.total) {
    const { label, done, total } = row.repairing
    alerts.push({ ...own, key: `${row.id}-repairing`, tone: 'suggestion', text: `${prefix}repairing: ${label}  ${done}/${total}` })
  } else if (!row.provisioned && !row.repairing) {
    alerts.push({
      ...own,
      key: `${row.id}-unprovisioned`,
      tone: 'warning',
      text: `${prefix}unprovisioned: files the recipe names are missing`,
      action: { kind: 'repair' },
    })
  }

  for (const issue of row.issues) {
    if (issue.severity === 'error') {
      alerts.push({ ...own, key: `${row.id}-issue-${issue.code}`, tone: 'error', text: `${prefix}${issue.message}` })
    }
  }

  const pull = view.pulls[row.id]
  if (pull?.state === 'merged' && !row.root) {
    alerts.push({
      ...own,
      key: `${row.id}-merged`,
      tone: 'merged',
      text: `${prefix}PR #${pull.number} merged, worktree still on disk`,
      link: pull.url,
    })
  }

  return alerts
}

export function arrange(worktrees: Worktree[], here: Worktree, tracked: readonly string[]) {
  const mine = tracked
    .map((path) => worktrees.find((worktree) => worktree.path === path))
    .filter((worktree): worktree is Worktree => !!worktree && worktree.id !== here.id)
  const rows = [here, ...mine]
  const taken = new Set(rows.map((row) => row.id))
  return { rows, others: worktrees.filter((worktree) => !taken.has(worktree.id)) }
}

export function touchedPath(tool: string, text: unknown): string | null {
  if (!/ccwt_(create|start|stop|provision)_worktree$/.test(tool) || typeof text !== 'string') return null
  const match = /"path"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(text)
  if (!match) return null
  try {
    return JSON.parse(match[1]!) as string
  } catch {
    return null
  }
}

export function uptime(startedAt: string | null, now: number): string {
  if (!startedAt) return ''
  const seconds = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function summary(worktree: Worktree): string {
  if (worktree.services.length === 0) return 'no services'
  if (worktree.services.every((service) => service.state === 'stopped')) return 'stopped'
  return worktree.services.map((service) => `${service.name} ${word(service)}`).join(' . ')
}

export function owning(worktrees: Worktree[], cwd: string): Worktree | null {
  let best: Worktree | null = null
  for (const worktree of worktrees) {
    const inside = cwd === worktree.path || cwd.startsWith(`${worktree.path}/`)
    if (inside && (!best || worktree.path.length > best.path.length)) best = worktree
  }
  return best
}

export function clean(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x1f\x7f]/g, '')
}

export function chipText(service: Service): string {
  return `${service.name} ${word(service)}`
}

export function chipsWidth(services: readonly Service[]): number {
  return services.reduce(
    (sum, service, index) =>
      sum + chipText(service).length + (service.port === null ? 0 : ` localhost:${service.port}`.length) + (index ? 3 : 0),
    0,
  )
}

export function mainService(row: Worktree): Service | undefined {
  return row.services.find((service) => service.primary) ?? row.services[0]
}

export function chipWidth(service: Service | undefined): number {
  if (!service) return 'no services'.length
  return chipText(service).length + (service.port === null ? 0 : ` localhost:${service.port}`.length)
}
