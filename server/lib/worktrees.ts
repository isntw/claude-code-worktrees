import { basename, join, resolve } from 'node:path'
import type { AgentStatus, Project, ServiceStatus, Worktree } from '../../shared/types'
import {
  addWorktree,
  classify,
  enableWorktreeConfig,
  idFor,
  isInside,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
} from './git'
import { pathExists, readJsonSafe } from './fs'
import { allocate, readAllocated, release } from './ports'
import { provision, worktreePathFor, worktreesDirFor } from './provision'
import { ENV_FILE, writeEnvBlock } from './envfile'
import * as supervisor from './supervisor'

const IDLE: AgentStatus = { state: 'idle', sessionId: null, subagents: 0, updatedAt: null }

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

async function allocateAll(
  project: Project,
  worktreePath: string,
): Promise<Record<string, number>> {
  await enableWorktreeConfig(project.rootPath)

  const ports: Record<string, number> = {}
  for (const service of project.config?.services ?? []) {
    ports[service.name] = await allocate(worktreePath, service.name, service.portRange)
  }

  if (Object.keys(ports).length) {
    await writeEnvBlock(worktreePath, ports).catch(() => undefined)
  }

  return ports
}

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
      if (live) return live

      const port = await readAllocated(worktreePath, service.name)
      return {
        name: service.name,
        state: 'stopped' as const,
        port,
        url: null,
        pid: null,
        startedAt: null,
        exitCode: null,
        reachable: null,
      }
    }),
  )
}

export async function list(project: Project): Promise<Worktree[]> {
  if (!project.config) return []

  await pruneWorktrees(project.rootPath)

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
    const report = await provision(project.rootPath, path, project.packageManager ?? 'npm', config)

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

  const ports = await allocateAll(project, path)
  for (const [name, port] of Object.entries(ports)) {
    supervisor.note(id, 'provision', `${name} → port ${port}`)
  }
  if (Object.keys(ports).length) supervisor.note(id, 'provision', `wrote ${ENV_FILE}`)

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

  const ports = await allocateAll(project, worktreePath)
  const port = ports[service.name]!

  return supervisor.start(worktreeId, worktreePath, service, port, {
    port,
    ports,
    slug: basename(worktreePath),
    branch: branch ?? '',
    rootPath: project.rootPath,
    worktreePath,
  })
}

export async function remove(project: Project, worktreeId: string): Promise<void> {
  const worktree = await find(project, worktreeId)
  if (!worktree) throw new Error('No such worktree.')
  if (worktree.root) throw new Error('That is the repository root, not a worktree ccwt can remove.')
  if (worktree.locked) {
    throw new Error(worktree.lockReason || 'An agent is working here.')
  }

  const config = project.config
  const dir = config ? worktreesDirFor(project.rootPath, config) : null

  if (!dir || !isInside(dir, worktree.path)) {
    if (worktree.origin !== 'claude') {
      throw new Error(`${worktree.path} is outside this project's worktrees directory.`)
    }
  }

  await supervisor.stopWorktree(worktreeId)

  for (const service of config?.services ?? []) {
    await release(worktree.path, service.name).catch(() => undefined)
  }

  await removeWorktree(project.rootPath, worktree.path)
}
