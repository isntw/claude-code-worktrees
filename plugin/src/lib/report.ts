import type { Seen } from './discover.ts'

export const TITLE_PREFIX = 'ccwt · '

export interface Row {
  port: number
  up: boolean
}

export type Rows = Record<string, Row>

export interface HookPayload {
  hookSpecificOutput?: {
    hookEventName: string
    additionalContext?: string
    sessionTitle?: string
  }
}

export function snapshot(found: Seen): Rows {
  const rows: Rows = {}
  for (const worktree of found.worktrees) {
    for (const service of worktree.services) {
      if (service.port === null) continue
      rows[`${worktree.name}/${service.name}`] = { port: service.port, up: service.up }
    }
  }
  return rows
}

export function changes(before: Rows, after: Rows): string[] {
  const lines: string[] = []

  for (const [key, now] of Object.entries(after)) {
    const then = before[key]
    const where = `http://localhost:${now.port}`

    if (!then) {
      lines.push(`${key} → port ${now.port}${now.up ? `, running at ${where}` : ', stopped'}`)
      continue
    }
    if (then.port !== now.port) {
      lines.push(
        `${key} moved to port ${now.port} (was ${then.port})${now.up ? ` and is running at ${where}` : ' and is stopped'}`,
      )
      continue
    }
    if (then.up !== now.up) {
      lines.push(now.up ? `${key} is now running at ${where}` : `${key} has stopped`)
    }
  }

  for (const key of Object.keys(before)) {
    if (!after[key]) lines.push(`${key} is gone`)
  }

  return lines
}

export function renameTo(
  found: Seen,
  current: string | undefined,
  ours: string | undefined,
): string | null {
  if (!found.here || found.here.root) return null

  const wanted = `${TITLE_PREFIX}${found.projectName}/${found.here.name}`
  if (wanted === current) return null

  if (!current) return wanted
  if (!ours) return wanted
  return current === ours ? wanted : null
}

export function overview(found: Seen): string | null {
  const rows = found.worktrees
    .filter((worktree) => worktree.services.some((service) => service.port !== null))
    .map((worktree) => {
      const services = worktree.services
        .filter((service) => service.port !== null)
        .map(
          (service) =>
            `${service.name} → ${service.port} ${service.up ? `running at http://localhost:${service.port}` : 'stopped'}`,
        )
        .join(', ')
      return `  ${worktree.name}${worktree.root ? ' (root)' : ''} — ${services}`
    })

  if (!rows.length) return null

  return [
    'ccwt manages this repository. It owns these services and the ports they run on:',
    ...rows,
    '',
    'Do not start a dev server yourself — open the URL above instead. Starting and stopping one is',
    'ccwt’s job: ccwt_start_worktree and ccwt_stop_worktree. Call ccwt_get_logs to see what a running',
    'service has printed rather than building to find out.',
  ].join('\n')
}

export function payloadFor(
  event: string,
  context: string | null,
  title: string | null,
): HookPayload {
  if (!context && !title) return {}

  return {
    hookSpecificOutput: {
      hookEventName: event,
      ...(context ? { additionalContext: context } : {}),
      ...(title ? { sessionTitle: title } : {}),
    },
  }
}
