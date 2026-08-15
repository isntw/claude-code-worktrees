import type {
  Overview,
  OverviewIssue,
  OverviewProject,
  OverviewRow,
  OverviewTotals,
  PortClaim,
  PortRow,
  Project,
  ServiceState,
  Worktree,
} from '../../shared/types'
import * as projects from './projects'
import * as worktrees from './worktrees'

function isLive(state: ServiceState): boolean {
  return state === 'running' || state === 'starting'
}

interface Gathered {
  project: Project
  found: Worktree[]
  readable: boolean
  why: string | null
}

async function gather(project: Project): Promise<Gathered> {
  try {
    return { project, found: await worktrees.list(project), readable: true, why: null }
  } catch (cause) {
    return { project, found: [], readable: false, why: (cause as Error).message }
  }
}

function tally(
  rows: OverviewRow[],
): Pick<OverviewTotals, 'services' | 'running' | 'starting' | 'crashed'> {
  let services = 0
  let running = 0
  let starting = 0
  let crashed = 0

  for (const row of rows) {
    for (const service of row.worktree.services) {
      services += 1
      if (service.state === 'running') running += 1
      if (service.state === 'starting') starting += 1
      if (service.state === 'crashed') crashed += 1
    }
  }

  return { services, running, starting, crashed }
}

function portRows(claims: Map<number, PortClaim[]>): PortRow[] {
  return [...claims.entries()]
    .sort(([left], [right]) => left - right)
    .map(([port, at]) => ({ port, claims: at }))
}

export async function build(): Promise<Overview> {
  const registered = await projects.list()
  const gathered = await Promise.all(registered.map(gather))

  const rows: OverviewRow[] = []
  const summaries: OverviewProject[] = []
  const issues: OverviewIssue[] = []
  const claims = new Map<number, PortClaim[]>()

  for (const { project, found, readable, why } of gathered) {
    const where = { projectId: project.id, projectName: project.name }
    let errors = 0

    const record = (issue: OverviewIssue) => {
      issues.push(issue)
      if (issue.severity === 'error') errors += 1
    }

    for (const issue of project.issues) {
      record({ ...issue, ...where, worktree: null })
    }

    if (!readable) {
      record({
        code: 'project.unreadable',
        severity: 'error',
        message: `Could not read the worktrees of ${project.name}${why ? ` — ${why}` : ''}`,
        hint: 'Open the project to see what git says.',
        ...where,
        worktree: null,
      })
    }

    for (const worktree of found) {
      rows.push({ ...where, worktree })

      for (const issue of worktree.issues) {
        record({ ...issue, ...where, worktree: worktree.name })
      }

      for (const service of worktree.services) {
        if (service.port === null) continue

        const at = claims.get(service.port) ?? []
        at.push({
          ...where,
          worktreeId: worktree.id,
          worktreeName: worktree.name,
          service: service.name,
          state: service.state,
          url: service.url,
        })
        claims.set(service.port, at)
      }
    }

    summaries.push({
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      packageManager: project.packageManager,
      defaultBranch: project.defaultBranch,
      worktrees: found.length,
      live: found.filter((worktree) => worktree.services.some((s) => isLive(s.state))).length,
      errors,
      readable,
    })
  }

  const ports = portRows(claims)

  return {
    at: new Date().toISOString(),
    totals: {
      projects: summaries.length,
      worktrees: rows.length,
      errors: summaries.reduce((total, summary) => total + summary.errors, 0),
      ports: ports.length,
      ...tally(rows),
    },
    projects: summaries,
    rows,
    ports,
    issues,
  }
}
