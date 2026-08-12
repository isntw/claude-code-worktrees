import { z } from 'zod'
import type { CcwtConfig } from './types'

const NAME = /^[a-z0-9][a-z0-9_-]*$/i

const port = z.number().int().min(1).max(65535)

export const serviceSchema = z
  .strictObject({
    name: z.string().regex(NAME, 'Use letters, digits, dash or underscore.'),
    cwd: z.string().default('.'),
    command: z.string().min(1, 'A service needs a command.'),
    portRange: z
      .tuple([port, port])
      .refine(([low, high]) => low <= high, 'The range must start at or below its end.'),
    env: z.record(z.string(), z.string()).optional(),
    dependsOn: z.array(z.string()).optional(),
  })
  .describe('service')

export const configSchema = z
  .strictObject({
    worktreesDir: z.string().min(1).default('../.worktrees'),
    packageManager: z.enum(['auto', 'npm', 'pnpm', 'yarn', 'bun']).default('auto'),
    provision: z
      .strictObject({
        dependencies: z.enum(['auto', 'install', 'hardlink', 'copy', 'none']).default('auto'),
        copy: z.array(z.string()).default([]),
        link: z.array(z.string()).default([]),
        postCreate: z.array(z.string()).default([]),
        postRemove: z.array(z.string()).default([]),
      })
      .prefault({}),
    services: z
      .array(serviceSchema)
      .default([])
      .refine(
        (services) => new Set(services.map((s) => s.name)).size === services.length,
        'Two services share a name.',
      ),
    claude: z
      .strictObject({
        trackSessions: z.boolean().default(false),
        ownWorktreeCreation: z.boolean().default(false),
        launchCommand: z.string().min(1).default('claude'),
      })
      .prefault({}),
  })
  .superRefine((config, ctx) => {
    const names = new Set(config.services.map((service) => service.name))

    config.services.forEach((service, index) => {
      for (const dependency of service.dependsOn ?? []) {
        if (dependency === service.name) {
          ctx.addIssue({
            code: 'custom',
            path: ['services', index, 'dependsOn'],
            message: `\`${service.name}\` cannot depend on itself.`,
          })
          continue
        }
        if (!names.has(dependency)) {
          ctx.addIssue({
            code: 'custom',
            path: ['services', index, 'dependsOn'],
            message: `There is no service called \`${dependency}\`.`,
          })
        }
      }
    })

    const cycle = findCycle(config.services)
    if (cycle) {
      ctx.addIssue({
        code: 'custom',
        path: ['services'],
        message: `These services depend on each other in a loop: ${cycle.join(' → ')}.`,
      })
    }
  })
  .describe('ccwt.config.json')

interface Dependant {
  name: string
  dependsOn?: string[]
}

export function findCycle(services: Dependant[]): string[] | null {
  const edges = new Map(services.map((service) => [service.name, service.dependsOn ?? []]))
  const state = new Map<string, 'open' | 'done'>()
  const trail: string[] = []

  const walk = (name: string): string[] | null => {
    if (state.get(name) === 'done') return null
    if (state.get(name) === 'open') return [...trail.slice(trail.indexOf(name)), name]

    state.set(name, 'open')
    trail.push(name)

    for (const next of edges.get(name) ?? []) {
      if (!edges.has(next)) continue
      const found = walk(next)
      if (found) return found
    }

    trail.pop()
    state.set(name, 'done')
    return null
  }

  for (const service of services) {
    const found = walk(service.name)
    if (found) return found
  }

  return null
}

export interface ConfigIssue {
  path: string
  message: string
}

export type ParseResult =
  | { ok: true; config: CcwtConfig }
  | { ok: false; issues: ConfigIssue[] }

export function parseConfig(value: unknown): ParseResult {
  const result = configSchema.safeParse(value)

  if (result.success) {
    return { ok: true, config: result.data as CcwtConfig }
  }

  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.join('.') : '(root)',
      message: issue.message,
    })),
  }
}

export function parseConfigText(text: string): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    return { ok: false, issues: [{ path: '(root)', message: (cause as Error).message }] }
  }
  return parseConfig(value)
}
