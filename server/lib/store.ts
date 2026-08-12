import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface ProjectRecord {
  id: string
  rootPath: string
  addedAt: string
}

export interface State {
  version: 1
  projects: ProjectRecord[]
}

export function stateDir(): string {
  return join(homedir(), '.ccwt')
}

export function statePath(): string {
  return join(stateDir(), 'state.json')
}

export function tokenPath(): string {
  return join(stateDir(), 'token')
}

function isRecord(value: unknown): value is ProjectRecord {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ProjectRecord>
  return typeof candidate.id === 'string' && typeof candidate.rootPath === 'string'
}

export async function readState(): Promise<State> {
  const raw = await readFile(statePath(), 'utf8').catch(() => null)
  if (raw === null) return { version: 1, projects: [] }

  try {
    const parsed = JSON.parse(raw) as Partial<State>
    const projects = Array.isArray(parsed.projects) ? parsed.projects.filter(isRecord) : []
    return { version: 1, projects }
  } catch {
    return { version: 1, projects: [] }
  }
}

export async function writeState(state: State): Promise<void> {
  await mkdir(dirname(statePath()), { recursive: true, mode: 0o700 })
  await writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

export async function listRecords(): Promise<ProjectRecord[]> {
  const state = await readState()
  return state.projects
}

export async function findRecord(id: string): Promise<ProjectRecord | null> {
  const state = await readState()
  return state.projects.find((project) => project.id === id) ?? null
}

export async function addRecord(record: ProjectRecord): Promise<ProjectRecord> {
  const state = await readState()
  const existing = state.projects.find((project) => project.id === record.id)
  if (existing) return existing

  state.projects.push(record)
  await writeState(state)
  return record
}

export async function removeRecord(id: string): Promise<boolean> {
  const state = await readState()
  const next = state.projects.filter((project) => project.id !== id)
  if (next.length === state.projects.length) return false

  await writeState({ ...state, projects: next })
  return true
}
