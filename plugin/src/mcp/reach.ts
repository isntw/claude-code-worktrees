import { resolve, sep } from 'node:path'
import { call as request, locate } from '../lib/discover.ts'
import type { Answer, Placed, Project } from '../lib/discover.ts'
import type { WorktreeLike } from './answer.ts'

export const NO_SERVER =
  'ccwt is not running, so its recipe store is not reachable. Start the ccwt dashboard and try again.'

export const SOURCES: Record<string, string> = {
  ccwt: 'a recipe stored in ccwt',
  none: 'no recipe — ccwt stores none for this repository and detects nothing',
}

export interface Standing extends Placed {
  project: Project | null
}

export async function place(path?: string): Promise<{ error: string } | Standing> {
  const found = await locate(path ?? process.cwd())
  if (!found) return { error: 'This directory is not inside a git repository.' }
  if (!found.reachable) return { error: NO_SERVER }
  return found
}

export function within(parent: string, child: string): boolean {
  const above = resolve(parent)
  const below = resolve(child)
  return below === above || below.startsWith(`${above}${sep}`)
}

export const unregistered = (found: Standing): string =>
  `${found.rootPath} is not registered with ccwt. Register it with ccwt_add_project first.`

export function why(result: Answer<unknown>, what: string): string {
  if (!result.server) return NO_SERVER
  if (result.ok && result.body === null) {
    return `ccwt answered the request to ${what} with something that is not JSON, which is what an older ccwt does with a route it does not have. Update ccwt so it matches this plugin.`
  }
  if (result.timedOut) {
    return `ccwt did not answer the request to ${what} in time, so this plugin stopped waiting. It was not refused, and ccwt may well be carrying it out. Check ccwt_get_status before starting anything yourself.`
  }
  if (result.status === 0) {
    return `ccwt could not be reached to ${what}, though it was listening a moment ago. It may have been closed mid-request.`
  }
  const said = (result.body as { message?: string; statusMessage?: string } | null)?.message
    || (result.body as { statusMessage?: string } | null)?.statusMessage
  const spoken = said?.trim().replace(/\.$/, '')
  return `ccwt refused to ${what} (${result.status})${spoken ? `: ${spoken}` : ''}.`
}

export const answered = <T>(result: Answer<T>): boolean => result.ok && result.body !== null

export async function pick(
  found: Standing,
  worktree: string | undefined,
  what: string,
): Promise<{ error: string } | { all: WorktreeLike[]; chosen: WorktreeLike }> {
  const listed = await request<WorktreeLike[]>(
    'GET',
    `/api/projects/${found.project!.id}/worktrees`,
  )
  if (!answered(listed)) return { error: why(listed, 'list this repository’s worktrees') }

  const all = Array.isArray(listed.body) ? listed.body : []
  const chosen = worktree
    ? all.find((entry) => entry.name === worktree)
    : all.find((entry) => resolve(entry.path) === resolve(found.here))

  if (chosen) return { all, chosen }

  return {
    error: [
      worktree
        ? `This repository has no worktree called \`${worktree}\`.`
        : `This directory is not one of ccwt’s worktrees. Name the one to ${what} with \`worktree\`:`,
      ...all.map((entry) => `  ${entry.name} — ${entry.path}`),
    ].join('\n'),
  }
}

export function serviceProblem(wanted: WorktreeLike, service: string | undefined): string | null {
  if (!wanted.services.length) {
    return `${wanted.name} has no services — the recipe for this repository declares none. Write one with ccwt_write_recipe.`
  }
  if (service && !wanted.services.some((entry) => entry.name === service)) {
    return `\`${service}\` is not a service in this recipe. It declares: ${wanted.services.map((entry) => entry.name).join(', ')}.`
  }
  return null
}

export interface RecipeNoteLike {
  path: string
  severity: string
  message: string
  hint?: string
}

export interface IssueLike {
  path: string
  message: string
}

export function renderNotes(notes: RecipeNoteLike[] | undefined): string[] {
  if (!notes?.length) return []
  return [
    '',
    `${notes.length} thing${notes.length > 1 ? 's' : ''} worth fixing:`,
    ...notes.map((note) => {
      const hint = note.hint ? ` ${note.hint}` : ''
      return `  ${note.severity === 'warning' ? '!' : '-'} ${note.path}: ${note.message}${hint}`
    }),
  ]
}

export const renderIssues = (issues: IssueLike[] | undefined): string[] =>
  (issues ?? []).map((issue) => `  ${issue.path}: ${issue.message}`)
