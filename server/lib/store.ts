import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Project } from '../../shared/types'

export interface State {
  version: 1
  projects: Project[]
}

const EMPTY: State = { version: 1, projects: [] }

export function stateDir(): string {
  return join(homedir(), '.ccwt')
}

export function statePath(): string {
  return join(stateDir(), 'state.json')
}

export function tokenPath(): string {
  return join(stateDir(), 'token')
}

export async function readState(): Promise<State> {
  const raw = await readFile(statePath(), 'utf8').catch(() => null)
  if (raw === null) return { ...EMPTY, projects: [] }

  try {
    const parsed = JSON.parse(raw) as Partial<State>
    return { version: 1, projects: Array.isArray(parsed.projects) ? parsed.projects : [] }
  } catch {
    return { ...EMPTY, projects: [] }
  }
}

export async function writeState(state: State): Promise<void> {
  await mkdir(dirname(statePath()), { recursive: true, mode: 0o700 })
  await writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

export async function findProject(id: string): Promise<Project | null> {
  const state = await readState()
  return state.projects.find((project) => project.id === id) ?? null
}
