import { z } from 'zod'
import type { CcwtConfig } from './types'

const NAME = /^[a-z0-9][a-z0-9_-]*$/i
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/

export const RECIPE_REVISION = 3

const RETIRED_KEYS = ['packageManager']
const RETIRED_PROVISION_KEYS = ['dependencies']
const RETIRED_CLAUDE_KEYS = ['trackSessions', 'launchCommand']

function without(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const rest: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  for (const key of keys) delete rest[key]
  return rest
}

const port = z.number().int().min(1).max(65535)

const range = z
  .tuple([port, port])
  .refine(([low, high]) => low <= high, 'The range must start at or below its end.')

export const serviceSchema = z
  .strictObject({
    name: z.string().regex(NAME, 'Use letters, digits, dash or underscore.'),
    kind: z.enum(['command', 'stack']).optional(),
    cwd: z.string().default('.'),
    command: z.string().min(1, 'A service needs a command.'),
    portRange: range,
    ports: z
      .record(z.string().regex(VARIABLE, 'Use a name an environment variable may have.'), range)
      .optional(),
    env: z.record(z.string(), z.string()).optional(),
    dependsOn: z.array(z.string()).optional(),
    postStart: z.array(z.string()).optional(),
    stopCommand: z.string().optional(),
    removeCommand: z.string().optional(),
  })
  .describe('service')

const configObject = z
  .strictObject({
    worktreesDir: z.string().min(1).default('../.worktrees'),
    provision: z
      .preprocess(
        (value) => without(value, RETIRED_PROVISION_KEYS),
        z.strictObject({
          copy: z.array(z.string()).default([]),
          link: z.array(z.string()).default([]),
          write: z
            .array(
              z.strictObject({
                path: z.string().min(1, 'A written file needs a path.'),
                content: z.string(),
              }),
            )
            .default([]),
          postCreate: z.array(z.string()).default([]),
          postRemove: z.array(z.string()).default([]),
        }),
      )
      .prefault({}),
    services: z
      .array(serviceSchema)
      .default([])
      .refine(
        (services) => new Set(services.map((s) => s.name)).size === services.length,
        'Two services share a name.',
      ),
    claude: z
      .preprocess(
        (value) => without(value, RETIRED_CLAUDE_KEYS),
        z.strictObject({ ownWorktreeCreation: z.boolean().default(false) }),
      )
      .prefault({}),
  })
  .superRefine((config, ctx) => {
    const names = new Set(config.services.map((service) => service.name))

    config.services.forEach((service, index) => {
      for (const variable of Object.keys(service.ports ?? {})) {
        if (names.has(variable)) {
          ctx.addIssue({
            code: 'custom',
            path: ['services', index, 'ports', variable],
            message: `\`${variable}\` is also a service name, so \`{{port.${variable}}}\` would be ambiguous.`,
          })
        }
      }

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

    config.provision.write.forEach((entry, index) => {
      if (entry.path.startsWith('/') || entry.path.includes('..')) {
        ctx.addIssue({
          code: 'custom',
          path: ['provision', 'write', index, 'path'],
          message: 'A written path must be relative and stay inside the worktree.',
        })
      }

      if (/\{\{(port|url)\b/.test(entry.content)) {
        ctx.addIssue({
          code: 'custom',
          path: ['provision', 'write', index, 'content'],
          message:
            'Ports are not allocated yet when a file is written. Read the port from the environment instead — `${MY_PORT}` in the file, and `MY_PORT` under the service’s `ports`.',
        })
      }

      if (entry.content.includes('{{branch}}')) {
        ctx.addIssue({
          code: 'custom',
          path: ['provision', 'write', index, 'content'],
          message: 'A written file may use {{project}}, {{slug}}, {{rootPath}} and {{worktreePath}}.',
        })
      }
    })

    const paths = config.provision.write.map((entry) => entry.path)
    if (new Set(paths).size !== paths.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['provision', 'write'],
        message: 'Two written files share a path.',
      })
    }
  })

export const configSchema = z
  .preprocess((value) => without(value, RETIRED_KEYS), configObject)
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
