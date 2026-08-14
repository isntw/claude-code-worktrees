import { basename, join, resolve } from 'node:path'
import type {
  AgentStatus,
  LockState,
  Project,
  ServiceConfig,
  ServiceStatus,
  Worktree,
} from '../../shared/types'
import {
  addWorktree,
  classify,
  enableWorktreeConfig,
  idFor,
  isIgnored,
  isInside,
  listWorktrees,
  lockWorktree,
  pruneWorktrees,
  removeWorktree,
  unlockWorktree,
} from './git'
import { isSymlink, pathExists, readJsonSafe } from './fs'
import { allocate, isListening, readAllocated, release } from './ports'
import type { Placeholders } from './provision'
import {
  needsWriting,
  provision,
  runPostRemove,
  worktreePathFor,
  worktreesDirFor,
} from './provision'
import * as supervisor from './supervisor'

const IDLE: AgentStatus = { state: 'idle', sessionId: null, subagents: 0, updatedAt: null }

function stillRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function lockStateOf(locked: boolean, reason: string | null): LockState | null {
  if (!locked) return null

  const found = reason?.match(/\bpid\s+(\d+)/i)
  const pid = found ? Number(found[1]) : 0
  if (pid <= 0) return 'unknown'

  return stillRunning(pid) ? 'live' : 'gone'
}

async function isProvisioned(worktreePath: string): Promise<boolean> {
  const manifest = await readJsonSafe<{
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }>(join(worktreePath, 'package.json'))

  if (!manifest) return true

  const needed =
    Object.keys(manifest.dependencies ?? {}).length +
    Object.keys(manifest.devDependencies ?? {}).length

  if (needed === 0) return true
  return pathExists(join(worktreePath, 'node_modules'))
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function noteExposed(
  worktreeId: string,
  worktreePath: string,
  written: string[],
): Promise<void> {
  for (const path of written) {
    if (await isIgnored(worktreePath, path)) continue
    supervisor.note(
      worktreeId,
      'provision',
      `${path} is not ignored by git, so it will show as untracked here — add it to .gitignore`,
    )
  }
}

function placeholders(project: Project, worktreePath: string): Placeholders {
  return {
    project: slugify(project.name),
    slug: basename(worktreePath),
    rootPath: project.rootPath,
    worktreePath,
  }
}

interface Allocation {
  ports: Record<string, number>
  named: Record<string, Record<string, number>>
}

async function allocateAll(project: Project, worktreePath: string): Promise<Allocation> {
  await enableWorktreeConfig(project.rootPath)

  const ports: Record<string, number> = {}
  const named: Record<string, Record<string, number>> = {}

  for (const service of project.config?.services ?? []) {
    ports[service.name] = await allocate(worktreePath, service.name, service.portRange)

    const extra: Record<string, number> = {}
    for (const [variable, range] of Object.entries(service.ports ?? {})) {
      extra[variable] = await allocate(worktreePath, `${service.name}-${variable}`, range)
    }
    named[service.name] = extra
  }

  return { ports, named }
}

const PROBE_MS = 250

async function servicesFor(
  project: Project,
  worktreeId: string,
  worktreePath: string,
): Promise<ServiceStatus[]> {
  const config = project.config
  if (!config) return []

  return Promise.all(
    config.services.map(async (service) => {
      const live = supervisor.status(worktreeId, service.name)
      if (live && live.state !== 'stopped') return live

      const port = await readAllocated(worktreePath, service.name, service.portRange)
      return {
        name: service.name,
        state: 'stopped' as const,
        port,
        url: null,
        pid: null,
        startedAt: null,
        exitCode: null,
        reachable: null,
        taken: port === null ? false : await isListening(port, PROBE_MS),
      }
    }),
  )
}

export async function list(project: Project): Promise<Worktree[]> {
  if (!project.config) return []

  const dir = worktreesDirFor(project.rootPath, project.config)
  const raw = await listWorktrees(project.rootPath)

  return Promise.all(
    raw
      .filter((entry) => !entry.bare)
      .map(async (entry) => {
        const id = idFor(entry.path)
        const root = resolve(entry.path) === resolve(project.rootPath)

        return {
          id,
          projectId: project.id,
          name: root ? `${basename(entry.path)} (root)` : basename(entry.path),
          path: entry.path,
          root,
          branch: entry.branch,
          head: entry.head,
          origin: classify(project.rootPath, dir, entry.path),
          detached: entry.detached,
          bare: entry.bare,
          locked: entry.locked,
          lockReason: entry.lockReason,
          lockState: lockStateOf(entry.locked, entry.lockReason),
          prunable: entry.prunable,
          provisioned: await isProvisioned(entry.path),
          services: await servicesFor(project, id, entry.path),
          agent: IDLE,
          issues: [],
        }
      }),
  )
}

export async function find(project: Project, worktreeId: string): Promise<Worktree | null> {
  const all = await list(project)
  return all.find((worktree) => worktree.id === worktreeId) ?? null
}

export interface CreateInput {
  name: string
  branch: string
  start: boolean
}

export async function create(project: Project, input: CreateInput): Promise<Worktree> {
  const config = project.config
  if (!config) throw new Error('This project has no resolvable configuration.')

  const slug = slugify(input.name)
  if (!slug) throw new Error('That name has no usable characters in it.')

  const path = worktreePathFor(project.rootPath, config, slugify(project.name), slug)

  if (await pathExists(path)) {
    throw new Error(`${path} already exists.`)
  }

  const id = idFor(path)
  const branch = input.branch.trim() || slug

  supervisor.note(id, 'provision', `git worktree add ${path} (${branch})`)
  await addWorktree(project.rootPath, path, branch)
  await enableWorktreeConfig(project.rootPath)

  supervisor.note(id, 'provision', 'provisioning…')
  try {
    const report = await provision(
      project.rootPath,
      path,
      project.packageManager ?? 'npm',
      config,
      placeholders(project, path),
    )

    if (report.written.length) {
      supervisor.note(id, 'provision', `wrote ${report.written.join(', ')}`)
      await noteExposed(id, path, report.written)
    }

    if (report.replaced.length)
      supervisor.note(id, 'provision', `replaced symlinks: ${report.replaced.join(', ')}`)
    if (report.copied.length) supervisor.note(id, 'provision', `copied ${report.copied.join(', ')}`)
    if (report.linked.length) supervisor.note(id, 'provision', `linked ${report.linked.join(', ')}`)
    if (report.pruned.length)
      supervisor.note(id, 'provision', `kept per-worktree: ${report.pruned.join(', ')}`)
    for (const skip of report.skipped)
      supervisor.note(id, 'provision', `skipped ${skip.path} — ${skip.reason}`)
    for (const failure of report.failed)
      supervisor.note(id, 'provision', `${failure.path} — ${failure.message}`, 'stderr')
  } catch (cause) {
    supervisor.note(id, 'provision', (cause as Error).message, 'stderr')
  }

  const { ports, named } = await allocateAll(project, path)
  for (const [name, port] of Object.entries(ports)) {
    supervisor.note(id, 'provision', `${name} → port ${port}`)
    for (const [variable, extra] of Object.entries(named[name] ?? {})) {
      supervisor.note(id, 'provision', `${name} → ${variable}=${extra}`)
    }
  }
  supervisor.note(id, 'provision', 'ready')

  if (input.start) {
    for (const service of config.services) {
      await startService(project, id, path, service.name, branch).catch((cause: Error) => {
        supervisor.note(id, 'provision', cause.message, 'stderr')
      })
    }
  }

  const created = await find(project, id)
  if (!created) throw new Error('The worktree was created but did not appear in git worktree list.')
  return created
}

async function needsProvisioning(project: Project, worktreePath: string): Promise<boolean> {
  const config = project.config
  if (!config) return false

  for (const entry of [...config.provision.copy, ...config.provision.link]) {
    const target = join(worktreePath, entry)

    if (await isSymlink(target)) return true
    if (!(await pathExists(target)) && (await pathExists(join(project.rootPath, entry)))) return true
  }

  if (await needsWriting(worktreePath, config.provision.write, placeholders(project, worktreePath)))
    return true

  return !(await isProvisioned(worktreePath))
}

export async function reprovision(project: Project, worktreeId: string): Promise<Worktree> {
  const config = project.config
  if (!config) throw new Error('This project has no resolvable configuration.')

  const worktree = await find(project, worktreeId)
  if (!worktree) throw new Error('No such worktree.')

  supervisor.note(worktreeId, 'provision', 'provisioning…')

  try {
    const report = await provision(
      project.rootPath,
      worktree.path,
      project.packageManager ?? 'npm',
      config,
      placeholders(project, worktree.path),
    )

    if (report.written.length) {
      supervisor.note(worktreeId, 'provision', `wrote ${report.written.join(', ')}`)
      await noteExposed(worktreeId, worktree.path, report.written)
    }

    if (report.replaced.length)
      supervisor.note(
        worktreeId,
        'provision',
        `replaced symlinks: ${report.replaced.join(', ')} — a symlink is followed inconsistently and can corrupt the root checkout`,
      )
    if (report.copied.length) supervisor.note(worktreeId, 'provision', `copied ${report.copied.join(', ')}`)
    if (report.linked.length) supervisor.note(worktreeId, 'provision', `linked ${report.linked.join(', ')}`)
    if (report.pruned.length)
      supervisor.note(worktreeId, 'provision', `kept per-worktree: ${report.pruned.join(', ')}`)
    for (const skip of report.skipped)
      supervisor.note(worktreeId, 'provision', `skipped ${skip.path} — ${skip.reason}`)
    for (const failure of report.failed)
      supervisor.note(worktreeId, 'provision', `${failure.path} — ${failure.message}`, 'stderr')
  } catch (cause) {
    supervisor.note(worktreeId, 'provision', (cause as Error).message, 'stderr')
  }

  await allocateAll(project, worktree.path)
  supervisor.note(worktreeId, 'provision', 'ready')

  const refreshed = await find(project, worktreeId)
  return refreshed ?? worktree
}

export async function startService(
  project: Project,
  worktreeId: string,
  worktreePath: string,
  serviceName: string,
  branch: string | null,
): Promise<ServiceStatus> {
  const config = project.config
  if (!config) throw new Error('This project has no resolvable configuration.')

  const service = config.services.find((candidate) => candidate.name === serviceName)
  if (!service) throw new Error(`No service named \`${serviceName}\` in this project.`)

  if (await needsProvisioning(project, worktreePath)) {
    await reprovision(project, worktreeId).catch((cause: Error) => {
      supervisor.note(worktreeId, 'provision', cause.message, 'stderr')
    })
  }

  const { ports, named } = await allocateAll(project, worktreePath)
  const order = startOrder(config.services, service.name)

  let status: ServiceStatus | null = null

  for (const name of order) {
    const next = config.services.find((candidate) => candidate.name === name)!

    const live = supervisor.status(worktreeId, name)
    const already = live && (live.state === 'running' || live.state === 'starting')

    const port = ports[name]!

    if (!already) {
      status = await supervisor.start(worktreeId, worktreePath, next, port, {
        project: slugify(project.name),
        port,
        ports,
        named: named[name] ?? {},
        slug: basename(worktreePath),
        branch: branch ?? '',
        rootPath: project.rootPath,
        worktreePath,
      })
    } else {
      status = live
    }

    if (name === service.name) break

    if (!(await supervisor.waitReachable(worktreeId, name))) {
      supervisor.note(
        worktreeId,
        service.name,
        `${name} never came up, starting ${service.name} anyway`,
        'stderr',
      )
    }
  }

  return status!
}

export function startOrder(services: ServiceConfig[], target?: string): string[] {
  const byName = new Map(services.map((service) => [service.name, service]))
  const seen = new Set<string>()
  const order: string[] = []

  const visit = (name: string, trail: Set<string>) => {
    if (seen.has(name) || trail.has(name)) return
    const service = byName.get(name)
    if (!service) return

    trail.add(name)
    for (const dependency of service.dependsOn ?? []) visit(dependency, trail)
    trail.delete(name)

    seen.add(name)
    order.push(name)
  }

  if (target) visit(target, new Set())
  else for (const service of services) visit(service.name, new Set())

  return order
}

export async function startAll(
  project: Project,
  worktreeId: string,
  worktreePath: string,
  branch: string | null,
): Promise<ServiceStatus[]> {
  const config = project.config
  if (!config) throw new Error('This project has no resolvable configuration.')

  const out: ServiceStatus[] = []
  for (const name of startOrder(config.services)) {
    out.push(await startService(project, worktreeId, worktreePath, name, branch))
  }
  return out
}

export const CCWT_LOCK_REASON = 'locked from ccwt'

export async function lock(project: Project, worktreeId: string): Promise<Worktree> {
  const worktree = await find(project, worktreeId)
  if (!worktree) throw new Error('No such worktree.')
  if (worktree.root) throw new Error('The repository root cannot be locked.')
  if (worktree.locked) return worktree

  await lockWorktree(project.rootPath, worktree.path, CCWT_LOCK_REASON)

  const after = await find(project, worktreeId)
  if (!after) throw new Error('No such worktree.')
  return after
}

export async function unlock(project: Project, worktreeId: string): Promise<Worktree> {
  const worktree = await find(project, worktreeId)
  if (!worktree) throw new Error('No such worktree.')
  if (!worktree.locked) return worktree

  if (worktree.lockState === 'live') {
    throw new Error(
      worktree.lockReason
        ? `Still held by a running process — ${worktree.lockReason}`
        : 'Still held by a running process.',
    )
  }

  await unlockWorktree(project.rootPath, worktree.path)

  const after = await find(project, worktreeId)
  if (!after) throw new Error('No such worktree.')
  return after
}

export async function remove(project: Project, worktreeId: string): Promise<void> {
  const worktree = await find(project, worktreeId)
  if (!worktree) throw new Error('No such worktree.')
  if (worktree.root) throw new Error('That is the repository root, not a worktree ccwt can remove.')
  if (worktree.locked) {
    throw new Error(worktree.lockReason || 'An agent is working here.')
  }

  if (worktree.prunable) {
    await supervisor.stopWorktree(worktreeId)
    await pruneWorktrees(project.rootPath)
    return
  }

  const config = project.config
  const dir = config ? worktreesDirFor(project.rootPath, config) : null

  if (!dir || !isInside(dir, worktree.path)) {
    if (worktree.origin !== 'claude') {
      throw new Error(`${worktree.path} is outside this project's worktrees directory.`)
    }
  }

  await supervisor.stopWorktree(worktreeId)

  const leaving: Record<string, number> = {}
  const leavingNamed: Record<string, number> = {}

  for (const service of config?.services ?? []) {
    const port = await readAllocated(worktree.path, service.name, service.portRange)
    if (port !== null) leaving[service.name] = port

    for (const [variable, range] of Object.entries(service.ports ?? {})) {
      const extra = await readAllocated(worktree.path, `${service.name}-${variable}`, range)
      if (extra !== null) leavingNamed[variable] = extra
    }
  }

  for (const command of config?.provision.postRemove ?? []) {
    let rendered: string
    try {
      rendered = supervisor.render(command, {
        project: slugify(project.name),
        port: 0,
        ports: leaving,
        named: leavingNamed,
        slug: basename(worktree.path),
        branch: worktree.branch ?? '',
        rootPath: project.rootPath,
        worktreePath: worktree.path,
      })
    } catch (cause) {
      supervisor.note(worktreeId, 'provision', (cause as Error).message, 'stderr')
      continue
    }

    await runPostRemove(worktree.path, rendered).catch(() => undefined)
  }

  for (const service of config?.services ?? []) {
    await release(worktree.path, service.name).catch(() => undefined)
    for (const variable of Object.keys(service.ports ?? {})) {
      await release(worktree.path, `${service.name}-${variable}`).catch(() => undefined)
    }
  }

  await removeWorktree(project.rootPath, worktree.path)
}
