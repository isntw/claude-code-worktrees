import { z } from 'zod'

export const ANSWER = {
  ok: z.boolean().describe('False when ccwt could not do what was asked; `message` says why.'),
  message: z.string().optional(),
}

export const SERVICE = z.object({
  name: z.string(),
  state: z.string(),
  port: z.number().nullable(),
  url: z.string().nullable(),
  exitCode: z.number().nullable(),
})

export const WORKTREE = {
  name: z.string().optional(),
  path: z.string().optional(),
  branch: z.string().nullable().optional(),
  provisioned: z.boolean().nullable().optional(),
  services: z.array(SERVICE).optional(),
}

export const NOTE = z.object({
  path: z.string(),
  severity: z.string(),
  message: z.string(),
  hint: z.string().optional(),
})

export const ISSUE = z.object({
  path: z.string(),
  message: z.string(),
  cycle: z
    .array(z.string())
    .optional()
    .describe(
      'Only on the issue that reports a `dependsOn` loop: the services in the loop in order, the first repeated at the end. The same chain the message spells out, as data — do not parse the message for it.',
    ),
})

export const PATH_ARG = z
  .string()
  .optional()
  .describe('A directory inside the repository. Defaults to the working directory.')

export interface Told {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
  structuredContent: Record<string, unknown>
  isError?: boolean
}

const say = (body: string | string[]) => (Array.isArray(body) ? body.join('\n') : body)

export const told = (body: string | string[], data: Record<string, unknown>): Told => ({
  content: [{ type: 'text', text: say(body) }],
  structuredContent: { ok: true, ...data },
})

export const nope = (body: string | string[]): Told => ({
  content: [{ type: 'text', text: say(body) }],
  structuredContent: { ok: false, message: say(body) },
})

export const broke = (body: string | string[]): Told => ({ ...nope(body), isError: true })

export const CHARACTER_LIMIT = 30_000

export interface Printed {
  service: string
  stream: string
  text: string
}

export interface Page<T> {
  lines: T[]
  older: number
  capped: boolean
}

export function pageOf<T extends Printed>(
  all: T[],
  limit: number,
  offset: number,
  budget = CHARACTER_LIMIT,
): Page<T> {
  const end = Math.max(0, all.length - offset)
  const wanted = Math.max(0, end - limit)

  let spent = 0
  let start = end

  for (let at = end - 1; at >= wanted; at -= 1) {
    const line = all[at]!
    const cost = 2 * (line.text.length + line.service.length) + 50

    if (start < end && spent + cost > budget) break

    spent += cost
    start = at
  }

  return { lines: all.slice(start, end), older: start, capped: start > wanted }
}

export interface ServiceLike {
  name: string
  state: string
  port?: number | null
  url?: string | null
  exitCode?: number | null
}

export interface WorktreeLike {
  id: string
  name: string
  path: string
  branch?: string | null
  provisioned?: boolean | null
  services: ServiceLike[]
}

export const shapeService = (status: ServiceLike) => ({
  name: status.name,
  state: status.state,
  port: status.port ?? null,
  url: status.url ?? null,
  exitCode: status.exitCode ?? null,
})

export const shapeWorktree = (worktree: WorktreeLike) => ({
  name: worktree.name,
  path: worktree.path,
  branch: worktree.branch ?? null,
  provisioned: worktree.provisioned ?? null,
  services: (worktree.services ?? []).map(shapeService),
})

export function describeService(status: ServiceLike): string {
  const where = status.url ? ` at ${status.url}` : status.port ? ` on port ${status.port}` : ''
  const failed =
    status.state === 'crashed' && status.exitCode !== null && status.exitCode !== undefined
      ? ` (exit ${status.exitCode})`
      : ''
  return `  ${status.name}: ${status.state}${where}${failed}`
}

export const describeWorktree = (worktree: WorktreeLike): string[] => [
  `${worktree.name} — ${worktree.path}`,
  `  branch ${worktree.branch ?? '(detached)'}`,
  ...(worktree.services ?? []).map(describeService),
]
