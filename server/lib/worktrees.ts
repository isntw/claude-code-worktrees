import { basename, join, resolve } from 'node:path'
import type {
  Recipe,
  LockState,
  PortHold,
  Project,
  RemoveOutcome,
  Service,
  ServiceStatus,
  Worktree,
} from '../../shared/types'
import { slugify } from '../../shared/route-keys'
import {
  addWorktree,
  classify,
  deleteBranch,
  enableWorktreeConfig,
  idFor,
  isIgnored,
  isProvisionedByCcwt,
  listWorktrees,
  lockWorktree,
  pruneWorktrees,
  readUnsaved,
  removeWorktree,
  unlockWorktree,
  writeWorktreeConfig,
} from './git'
import { isDirectory, isSymlink, pathExists } from './fs'
import { reapWithin } from './holders'
import { allocate, isFree, pruneSharedPorts, readAllocated, release } from './ports'
import type { Placeholders } from './provision'
import {
  divergedBeneath,
  missingBeneath,
  needsWriting,
  placeFiles,
  provision,
  runPostRemove,
  worktreePathFor,
  worktreesDirFor,
} from './provision'
import * as supervisor from './supervisor'

const LOCK_PID = /\bpid\s+(\d+)/i
const LOCK_START = /\bstart\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})/i
const START_SLACK_MS = 2000

function stillRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function startedWhenClaimed(pid: number, reason: string): Promise<boolean> {
  const claimed = reason.match(LOCK_START)?.[1]
  if (!claimed) return true

  const wanted = Date.parse(`${claimed} GMT`)
  if (Number.isNaN(wanted)) return true

  const reported = await supervisor.startTimeOf(pid)
  if (reported === null) return true

  const actual = Date.parse(`${reported} GMT`)
  if (Number.isNaN(actual)) return true

  const drift = Math.abs(actual - wanted)
  const zone = Math.abs(new Date(actual).getTimezoneOffset() * 60_000)

  return drift <= START_SLACK_MS || Math.abs(drift - zone) <= START_SLACK_MS
}

function lockedAtOf(locked: boolean, reason: string | null): string | null {
  if (!locked || !reason) return null

  const claimed = reason.match(LOCK_START)?.[1]
  if (!claimed) return null

  const at = Date.parse(`${claimed} GMT`)
  return Number.isNaN(at) ? null : new Date(at).toISOString()
}

async function lockStateOf(locked: boolean, reason: string | null): Promise<LockState | null> {
  if (!locked) return null

  const pid = Number(reason?.match(LOCK_PID)?.[1] ?? 0)
  if (!reason || pid <= 0) return 'unknown'
  if (!stillRunning(pid)) return 'gone'

  return (await startedWhenClaimed(pid, reason)) ? 'live' : 'gone'
}

function isLive(status: ServiceStatus | null): boolean {
  return status !== null && (status.state === 'running' || status.state === 'starting')
}

async function diverged(project: Project, worktreePath: string): Promise<boolean> {
  const recipe = project.recipe
  if (!recipe) return false

  for (const path of recipe.provision.link) {
    const source = join(project.rootPath, path)
    const target = join(worktreePath, path)

    if (!(await isDirectory(source)) || !(await isDirectory(target))) continue
    if (await divergedBeneath(path, source, target)) return true
  }

  return false
}

async function missing(project: Project, worktreePath: string): Promise<boolean> {
  const recipe = project.recipe
  if (!recipe) return false

  const entries = [
    ...recipe.provision.copy.map((path) => ({ path, linked: false })),
    ...recipe.provision.link.map((path) => ({ path, linked: true })),
  ]

  for (const { path, linked } of entries) {
    const target = join(worktreePath, path)
    const source = join(project.rootPath, path)

    if (await isSymlink(target)) return true

    if (!(await pathExists(target))) {
      if (await pathExists(source)) return true
      continue
    }

    if (linked && (await isDirectory(source)) && (await missingBeneath(path, source, target)))
      return true
  }

  return needsWriting(worktreePath, recipe.provision.write, placeholders(project, worktreePath))
}

async function outOfDate(project: Project, worktreePath: string): Promise<boolean> {
  return (await missing(project, worktreePath)) || (await diverged(project, worktreePath))
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

const portKey = (service: Service, variable: string) => `${service.name}-${variable}`

async function readNamedPorts(
  worktreePath: string,
  service: Service,
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    Object.entries(service.ports ?? {}).map(async ([variable, range]) => {
      const port = await readAllocated(worktreePath, portKey(service, variable), range)
      return [variable, port] as const
    }),
  )

  const named: Record<string, number> = {}
  for (const [variable, port] of entries) if (port !== null) named[variable] = port
  return named
}

interface Allocation {
  ports: Record<string, number>
  named: Record<string, Record<string, number>>
}

async function allocateAll(
  project: Project,
  worktreeId: string,
  worktreePath: string,
): Promise<Allocation> {
  await enableWorktreeConfig(project.rootPath)
  await pruneSharedPorts(project.rootPath)

  const ports: Record<string, number> = {}
  const named: Record<string, Record<string, number>> = {}
  const reserved = new Set<number>()

  const moved = (service: string, what: string, from: number, to: number) => {
    supervisor.note(worktreeId, service, `port ${from} is taken, so ${what} moved to ${to}`)
  }

  for (const service of project.recipe?.services ?? []) {
    const live = supervisor.status(worktreeId, service.name)
    const keep = isLive(live)

    const main = await allocate(worktreePath, service.name, service.portRange, { keep, reserved })
    if (main.from !== null) moved(service.name, service.name, main.from, main.port)
    reserved.add(main.port)
    ports[service.name] = main.port

    const extra: Record<string, number> = {}
    for (const [variable, range] of Object.entries(service.ports ?? {})) {
      const one = await allocate(worktreePath, portKey(service, variable), range, { keep, reserved })
      if (one.from !== null) moved(service.name, variable, one.from, one.port)
      reserved.add(one.port)
      extra[variable] = one.port
    }
    named[service.name] = extra
  }

  return { ports, named }
}

function holdOf(
  project: Project,
  worktreeId: string,
  service: string,
  port: number,
): PortHold | null {
  const held = supervisor
    .holding(port)
    .find((entry) => !(entry.worktreeId === worktreeId && entry.service === service))

  if (!held) return null

  const root = resolve(held.worktreePath) === resolve(held.rootPath)

  return {
    worktreeId: held.worktreeId,
    worktree: root ? 'root' : basename(held.worktreePath),
    service: held.service,
    same: resolve(held.rootPath) === resolve(project.rootPath),
  }
}

async function servicesFor(
  project: Project,
  worktreeId: string,
  worktreePath: string,
): Promise<ServiceStatus[]> {
  const recipe = project.recipe
  if (!recipe) return []

  return Promise.all(
    recipe.services.map(async (service) => {
      const live = supervisor.status(worktreeId, service.name)
      if (live && live.state !== 'stopped' && live.state !== 'crashed')
        return { ...live, primary: service.primary }

      const port = await readAllocated(worktreePath, service.name, service.portRange)
      const extra = await readNamedPorts(worktreePath, service)

      const contention = {
        taken: port === null ? false : !(await isFree(port)),
        movable: service.portRange[0] !== service.portRange[1],
        heldBy: port === null ? null : holdOf(project, worktreeId, service.name, port),
      }

      if (live) {
        return {
          ...live,
          primary: service.primary,
          port,
          ...contention,
          extra: Object.keys(extra).length ? extra : undefined,
        }
      }

      return {
        name: service.name,
        primary: service.primary,
        state: 'stopped' as const,
        port,
        url: null,
        pid: null,
        startedAt: null,
        exitCode: null,
        reachable: null,
        ...contention,
        extra: Object.keys(extra).length ? extra : undefined,
      }
    }),
  )
}

export async function list(project: Project): Promise<Worktree[]> {
  if (!project.recipe) return []

  const dir = worktreesDirFor(project.rootPath, project.recipe)
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
          name: basename(entry.path),
          path: entry.path,
          root,
          branch: entry.branch,
          head: entry.head,
          origin: classify(project.rootPath, dir, entry.path, await isProvisionedByCcwt(entry.path)),
          detached: entry.detached,
          bare: entry.bare,
          locked: entry.locked,
          lockReason: entry.lockReason,
          lockState: await lockStateOf(entry.locked, entry.lockReason),
          lockedAt: lockedAtOf(entry.locked, entry.lockReason),
          prunable: entry.prunable,
          provisioned: !(await outOfDate(project, entry.path)),
          services: await servicesFor(project, id, entry.path),
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
  const recipe = project.recipe
  if (!recipe) throw new Error('This project has no resolvable recipe.')

  const slug = slugify(input.name)
  if (!slug) throw new Error('That name has no usable characters in it.')

  const path = worktreePathFor(project.rootPath, recipe, slugify(project.name), slug)

  if (await pathExists(path)) {
    throw new Error(`${path} already exists.`)
  }

  const id = idFor(path)
  const branch = input.branch.trim() || slug

  supervisor.note(id, 'provision', `git worktree add ${path} (${branch})`)
  await addWorktree(project.rootPath, path, branch)
  await enableWorktreeConfig(project.rootPath)
  await writeWorktreeConfig(path, 'ccwt.created', 'true').catch(() => undefined)

  supervisor.note(id, 'provision', 'provisioning…')
  try {
    const report = await provision(project.rootPath, path, recipe, placeholders(project, path))

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

  const { ports, named } = await allocateAll(project, id, path)
  for (const [name, port] of Object.entries(ports)) {
    supervisor.note(id, 'provision', `${name} → port ${port}`)
    for (const [variable, extra] of Object.entries(named[name] ?? {})) {
      supervisor.note(id, 'provision', `${name} → ${variable}=${extra}`)
    }
  }
  supervisor.note(id, 'provision', 'ready')

  if (input.start) {
    for (const service of recipe.services) {
      await startService(project, id, path, service.name, branch).catch((cause: Error) => {
        supervisor.note(id, 'provision', cause.message, 'stderr')
      })
    }
  }

  const created = await find(project, id)
  if (!created) throw new Error('The worktree was created but did not appear in git worktree list.')
  return created
}

function liveServices(recipe: Recipe, worktreeId: string): string[] {
  return recipe.services
    .filter((service) => isLive(supervisor.status(worktreeId, service.name)))
    .map((service) => service.name)
}

async function repairFiles(
  project: Project,
  worktree: Worktree,
  refresh: boolean,
): Promise<string[]> {
  const recipe = project.recipe
  if (!recipe) return []
  if (worktree.root) throw new Error('The repository root is not provisioned by ccwt.')

  const worktreeId = worktree.id

  const live = refresh ? liveServices(recipe, worktreeId) : []

  if (live.length) {
    supervisor.note(worktreeId, 'provision', `stopping ${live.join(', ')} to update the worktree…`)
    for (const name of startOrder(recipe.services).reverse()) {
      if (live.includes(name)) await supervisor.stop(worktreeId, name)
    }
  }

  supervisor.note(
    worktreeId,
    'provision',
    refresh ? 'relinking what the recipe declares…' : 'putting back what the recipe declares…',
  )

  try {
    const report = await placeFiles(
      project.rootPath,
      worktree.path,
      recipe,
      placeholders(project, worktree.path),
      refresh,
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

  await allocateAll(project, worktreeId, worktree.path)
  supervisor.note(worktreeId, 'provision', 'ready')

  return live
}

async function resumeServices(
  project: Project,
  worktree: Worktree,
  live: string[],
): Promise<void> {
  const recipe = project.recipe
  if (!recipe || !live.length) return

  const worktreeId = worktree.id
  supervisor.note(worktreeId, 'provision', `starting ${live.join(', ')} back up…`)

  for (const name of startOrder(recipe.services)) {
    if (!live.includes(name)) continue
    await startService(project, worktreeId, worktree.path, name, worktree.branch, false).catch(
      (cause: Error) => {
        supervisor.note(worktreeId, name, cause.message, 'stderr')
        return null
      },
    )
  }
}

async function repairWorktree(
  project: Project,
  worktree: Worktree,
  refresh: boolean,
): Promise<void> {
  await resumeServices(project, worktree, await repairFiles(project, worktree, refresh))
}

export async function repair(
  project: Project,
  worktreeId: string,
  refresh = false,
): Promise<Worktree> {
  if (!project.recipe) throw new Error('This project has no resolvable recipe.')

  const worktree = await find(project, worktreeId)
  if (!worktree) throw new Error('No such worktree.')

  await repairWorktree(project, worktree, refresh)

  const refreshed = await find(project, worktreeId)
  return refreshed ?? worktree
}

export async function repairAll(project: Project, refresh = false): Promise<Worktree[]> {
  if (!project.recipe) throw new Error('This project has no resolvable recipe.')

  await enableWorktreeConfig(project.rootPath)
  await pruneSharedPorts(project.rootPath)

  const targets = (await list(project)).filter((worktree) => !worktree.root && !worktree.prunable)

  const placed = await Promise.all(
    targets.map(async (worktree) => ({
      worktree,
      live: await repairFiles(project, worktree, refresh).catch((cause: Error) => {
        supervisor.note(worktree.id, 'provision', cause.message, 'stderr')
        return [] as string[]
      }),
    })),
  )

  for (const { worktree, live } of placed) {
    await resumeServices(project, worktree, live).catch((cause: Error) => {
      supervisor.note(worktree.id, 'provision', cause.message, 'stderr')
    })
  }

  return list(project)
}

export async function startService(
  project: Project,
  worktreeId: string,
  worktreePath: string,
  serviceName: string,
  branch: string | null,
  mayRepair = true,
): Promise<ServiceStatus> {
  const recipe = project.recipe
  if (!recipe) throw new Error('This project has no resolvable recipe.')

  const service = recipe.services.find((candidate) => candidate.name === serviceName)
  if (!service) throw new Error(`No service named \`${serviceName}\` in this project.`)

  if (mayRepair && (await missing(project, worktreePath))) {
    await repair(project, worktreeId).catch((cause: Error) => {
      supervisor.note(worktreeId, 'provision', cause.message, 'stderr')
    })
  }

  const { ports, named } = await allocateAll(project, worktreeId, worktreePath)
  const order = startOrder(recipe.services, service.name)

  let status: ServiceStatus | null = null

  for (const name of order) {
    const next = recipe.services.find((candidate) => candidate.name === name)!

    const live = supervisor.status(worktreeId, name)
    const already = isLive(live)

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

export function startOrder(services: Service[], target?: string): string[] {
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
  const recipe = project.recipe
  if (!recipe) throw new Error('This project has no resolvable recipe.')

  const out: ServiceStatus[] = []
  for (const name of startOrder(recipe.services)) {
    out.push(await startService(project, worktreeId, worktreePath, name, branch))
  }
  return out
}

export async function stopAll(project: Project, worktreeId: string): Promise<ServiceStatus[]> {
  const recipe = project.recipe
  if (!recipe) throw new Error('This project has no resolvable recipe.')

  const out: ServiceStatus[] = []
  for (const name of startOrder(recipe.services).reverse()) {
    out.push(await supervisor.stop(worktreeId, name))
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

async function dropBranch(
  rootPath: string,
  branch: string | null,
  wanted: boolean,
): Promise<Omit<RemoveOutcome, 'stopped'>> {
  if (!wanted || !branch) return { branch, branchDeleted: false, branchIssue: null }

  const refused = await deleteBranch(rootPath, branch).catch((cause: Error) => cause.message)
  return { branch, branchDeleted: refused === null, branchIssue: refused }
}

function naming(paths: string[]): string {
  const shown = paths.slice(0, 3).join(', ')
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown
}

async function assertNothingToLose(worktreePath: string): Promise<void> {
  const unsaved = await readUnsaved(worktreePath)

  if (unsaved.changed.length) {
    throw new Error(
      `${worktreePath} has uncommitted changes (${naming(unsaved.changed)}). ccwt did not create this worktree, so it will not delete them — commit or discard them first.`,
    )
  }

  if (unsaved.ignored.length) {
    throw new Error(
      `${worktreePath} holds files git ignores (${naming(unsaved.ignored)}). ccwt did not create this worktree, so it will not delete them — clear them first.`,
    )
  }
}

export async function remove(
  project: Project,
  worktreeId: string,
  alsoBranch = false,
): Promise<RemoveOutcome> {
  const worktree = await find(project, worktreeId)
  if (!worktree) throw new Error('No such worktree.')
  if (worktree.root) throw new Error('That is the repository root, not a worktree ccwt can remove.')

  if (worktree.locked) {
    await unlockWorktree(project.rootPath, worktree.path).catch(() => undefined)
  }

  if (worktree.prunable) {
    await supervisor.stopWorktree(worktreeId)
    supervisor.forgetScrollback(worktreeId)
    await pruneWorktrees(project.rootPath)
    return { ...(await dropBranch(project.rootPath, worktree.branch, alsoBranch)), stopped: [] }
  }

  const recipe = project.recipe
  const owned = worktree.origin !== 'manual'

  if (!owned) await assertNothingToLose(worktree.path)

  await supervisor.stopWorktree(worktreeId)

  const leaving: Record<string, number> = {}
  const perService: Record<string, Record<string, number>> = {}

  for (const service of recipe?.services ?? []) {
    const port = await readAllocated(worktree.path, service.name, service.portRange)
    if (port !== null) leaving[service.name] = port
    perService[service.name] = await readNamedPorts(worktree.path, service)
  }

  const holding = new Set<number>(Object.values(leaving))
  for (const named of Object.values(perService)) {
    for (const port of Object.values(named)) holding.add(port)
  }

  const base = {
    project: slugify(project.name),
    ports: leaving,
    slug: basename(worktree.path),
    branch: worktree.branch ?? '',
    rootPath: project.rootPath,
    worktreePath: worktree.path,
  }

  for (const service of recipe?.services ?? []) {
    if (!service.removeCommand) continue

    const named = perService[service.name] ?? {}
    const port = leaving[service.name] ?? 0
    const vars = { ...base, port, named }

    let rendered: string
    try {
      rendered = supervisor.render(service.removeCommand, vars)
    } catch (cause) {
      supervisor.note(worktreeId, 'provision', (cause as Error).message, 'stderr')
      continue
    }

    supervisor.note(worktreeId, 'provision', `removing: ${rendered}`)
    await runPostRemove(
      resolve(worktree.path, service.cwd || '.'),
      rendered,
      supervisor.environmentFor(service, vars),
    ).catch(() => undefined)
  }

  const named = Object.assign({}, ...Object.values(perService)) as Record<string, number>

  for (const command of recipe?.provision.postRemove ?? []) {
    let rendered: string
    try {
      rendered = supervisor.render(command, { ...base, port: 0, named })
    } catch (cause) {
      supervisor.note(worktreeId, 'provision', (cause as Error).message, 'stderr')
      continue
    }

    await runPostRemove(worktree.path, rendered).catch(() => undefined)
  }

  const stopped: string[] = []

  for (const port of holding) {
    const strays = await reapWithin(port, worktree.path).catch(() => [])
    for (const stray of strays) {
      stopped.push(`${stray.name} (pid ${stray.pid}) was still holding port ${port}`)
    }
  }

  for (const service of recipe?.services ?? []) {
    await release(worktree.path, service.name).catch(() => undefined)
    for (const variable of Object.keys(service.ports ?? {})) {
      await release(worktree.path, portKey(service, variable)).catch(() => undefined)
    }
  }

  await removeWorktree(project.rootPath, worktree.path, owned)
  supervisor.forgetScrollback(worktreeId)

  return { ...(await dropBranch(project.rootPath, worktree.branch, alsoBranch)), stopped }
}
