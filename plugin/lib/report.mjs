export const TITLE_PREFIX = 'ccwt · '

export function snapshot(found) {
  const rows = {}
  for (const worktree of found.worktrees) {
    for (const service of worktree.services) {
      if (service.port === null) continue
      rows[`${worktree.name}/${service.name}`] = { port: service.port, up: service.up }
    }
  }
  return rows
}

export function changes(before, after) {
  const lines = []

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

export function renameTo(found, current, ours) {
  if (!found.here || found.here.root) return null

  const wanted = `${TITLE_PREFIX}${found.projectName}/${found.here.name}`
  if (wanted === current) return null

  if (!current) return wanted
  if (!ours) return wanted
  return current === ours ? wanted : null
}

export function overview(found) {
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
    'Do not start a dev server yourself — open the URL above instead. Starting, stopping and',
    'restarting a service is ccwt’s job, from its dashboard. Call ccwt_logs to see what a running',
    'service has printed rather than building to find out.',
  ].join('\n')
}
