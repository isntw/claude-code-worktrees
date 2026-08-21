import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { PLACE_MS, call as request, describe, reachServer } from '../lib/discover.ts'
import type { Seen } from '../lib/discover.ts'
import {
  ANSWER,
  ISSUE,
  NOTE,
  PATH_ARG,
  SERVICE,
  WORKTREE,
  broke,
  pageOf,
  describeService,
  describeWorktree,
  nope,
  shapeService,
  shapeWorktree,
  told,
} from './answer.ts'
import type { ServiceLike, Told, WorktreeLike } from './answer.ts'
import {
  SOURCES,
  answered,
  pick,
  place,
  renderIssues,
  renderNotes,
  serviceProblem,
  unregistered,
  why,
} from './reach.ts'
import type { IssueLike, RecipeNoteLike, Standing } from './reach.ts'

declare const VERSION: string
const TAIL = 100

const READS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const ACTS = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }

const server = new McpServer(
  { name: 'ccwt-mcp-server', version: VERSION },
  { capabilities: { tools: {} } },
)

const NAMES: string[] = []

const named = (name: string): string => {
  NAMES.push(name)
  return name
}

const standing = async (path?: string): Promise<Standing | { error: string }> => place(path)

const needsProject = (found: Standing | { error: string }): string | null => {
  if ('error' in found) return found.error
  if (!found.project) return unregistered(found)
  return null
}

server.registerTool(
  named('ccwt_get_status'),
  {
    title: 'What ccwt runs here',
    description:
      'What ccwt runs for the current repository: every worktree, its services, the port each is assigned, and whether that port is answering right now. Answers even when the ccwt dashboard is closed. Use this instead of starting a dev server to find out what is up.',
    inputSchema: z.strictObject({
      path: z
        .string()
        .optional()
        .describe(
          'A directory inside the repository to report on. Defaults to the working directory the server was started in — pass the worktree path when the session has moved.',
        ),
    }),
    outputSchema: {
      ...ANSWER,
      project: z.object({ name: z.string(), rootPath: z.string() }).optional(),
      worktrees: z
        .array(
          z.object({
            name: z.string(),
            path: z.string(),
            root: z.boolean(),
            services: z.array(
              z.object({
                name: z.string(),
                port: z.number().nullable(),
                up: z.boolean(),
                url: z.string().nullable(),
              }),
            ),
          }),
        )
        .optional(),
    },
    annotations: READS,
  },
  async ({ path }): Promise<Told> => {
    const found = await describe(path ?? process.cwd()).catch(() => null)
    if (!found) return nope('This directory is not inside a repository ccwt manages.')

    const lines = [`${found.projectName} — ${found.rootPath}`, '']

    for (const worktree of found.worktrees) {
      const services = worktree.services.map((service) =>
        service.port === null
          ? `    ${service.name}: no port allocated`
          : `    ${service.name}: port ${service.port} — ${service.up ? `running at http://localhost:${service.port}` : 'stopped'}`,
      )
      lines.push(`  ${worktree.name}${worktree.root ? ' (root)' : ''} — ${worktree.path}`, ...services)
    }

    lines.push(
      '',
      'ccwt owns these services. Open a URL rather than starting your own copy, and use',
      'ccwt_start_worktree and ccwt_stop_worktree rather than running or killing one yourself.',
      'A port against a stopped service is a reservation, not a promise: another stopped worktree',
      'may hold the same number, and whichever starts second is moved.',
    )

    return told(lines, {
      project: { name: found.projectName, rootPath: found.rootPath },
      worktrees: found.worktrees.map((worktree) => ({
        name: worktree.name,
        path: worktree.path,
        root: worktree.root,
        services: worktree.services.map((service) => ({
          name: service.name,
          port: service.port,
          up: service.up,
          url: service.port === null ? null : `http://localhost:${service.port}`,
        })),
      })),
    })
  },
)

interface LogLine {
  service: string
  stream: string
  text: string
}

server.registerTool(
  named('ccwt_get_logs'),
  {
    title: 'What a service printed',
    description:
      "A ccwt-managed service's recent output, so a change can be checked without starting or building anything. Requires the ccwt dashboard to be running.",
    inputSchema: z.strictObject({
      service: z
        .string()
        .optional()
        .describe('Service name, as ccwt_get_status reports it. Omit for every service.'),
      worktree: z
        .string()
        .optional()
        .describe(
          'Name of the worktree whose logs are wanted, as ccwt_get_status reports it. Defaults to the one the session is in.',
        ),
      path: z
        .string()
        .optional()
        .describe(
          'A directory inside the worktree, as an alternative to naming it. Take the path from ccwt_get_status rather than assembling one — ccwt nests a worktree under a directory named for the project.',
        ),
      limit: z.number().int().positive().optional().describe(`How many lines to return. Defaults to ${TAIL}. A page is also cut to fit one response, and says so.`),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          'How many lines back from the newest to end at, for reading further into the scrollback. Defaults to 0, the newest. A response says `nextOffset` when older lines remain.',
        ),
    }),
    outputSchema: {
      ...ANSWER,
      worktree: z.string().optional(),
      service: z.string().nullable().optional(),
      total: z.number().optional().describe('Lines ccwt holds for this worktree.'),
      count: z.number().optional().describe('Lines in this response.'),
      offset: z.number().optional(),
      hasMore: z.boolean().optional().describe('True when older lines remain.'),
      nextOffset: z
        .number()
        .nullable()
        .optional()
        .describe('Pass as `offset` for the lines before these.'),
      capped: z
        .boolean()
        .optional()
        .describe('True when the page was cut to fit one response rather than by `limit`.'),
      lines: z
        .array(z.object({ service: z.string(), stream: z.string(), text: z.string() }))
        .optional(),
    },
    annotations: READS,
  },
  async ({ service, worktree: wantedName, path, limit, offset }): Promise<Told> => {
    const asked = path ?? process.cwd()

    let found: Seen | null = await describe(asked).catch(() => null)
    let strayed = false

    if (!found && path) {
      found = await describe(process.cwd()).catch(() => null)
      strayed = found !== null
    }

    if (!found) return nope('This directory is not inside a repository ccwt manages.')

    const worktree = wantedName
      ? (found.worktrees.find((entry) => entry.name === wantedName) ?? null)
      : strayed
        ? null
        : found.here

    if (!worktree) {
      return nope([
        wantedName
          ? `This repository has no worktree called \`${wantedName}\`.`
          : strayed
            ? `${asked} is not one of ccwt’s worktrees. Name it with \`worktree\`, or pass one of these paths — a worktree sits under a directory named for the project, so an assembled path misses a segment:`
            : 'This directory is not one of ccwt’s worktrees. Name the one you mean with `worktree`:',
        ...found.worktrees.map((entry) => `  ${entry.name} — ${entry.path}`),
      ])
    }

    const runtime = await reachServer()
    if (!runtime) {
      return nope(
        'ccwt is not running, so its logs are not reachable. Start the ccwt dashboard and try again — ccwt keeps a service’s output only while it is running.',
      )
    }

    const asking = await request<LogLine[]>(
      'GET',
      `/api/projects/${found.projectId}/worktrees/${worktree.id}/logs`,
    )
    if (!answered(asking)) return broke(why(asking, `read ${worktree.name} logs`))

    const all = Array.isArray(asking.body) ? asking.body : []
    const wanted = service ? all.filter((line) => line.service === service) : all

    if (!wanted.length) {
      return nope(
        `No output recorded for ${service ? `\`${service}\` in ` : ''}${worktree.name}. ccwt keeps a service's scrollback only while that service is running.`,
      )
    }

    const from = offset ?? 0
    const { lines: page, older, capped } = pageOf(wanted, limit ?? TAIL, from)

    if (!page.length) {
      return nope(
        `\`offset\` ${from} is past the ${wanted.length} line${wanted.length === 1 ? '' : 's'} recorded for ${worktree.name}.`,
      )
    }

    const more = older > 0

    return told(
      [
        `${worktree.name} — ${page.length} of ${wanted.length} lines, ending ${from ? `${from} from the newest` : 'at the newest'}`,
        capped
          ? `Cut to fit one response: ${older} older line${older === 1 ? '' : 's'} not shown, fewer than \`limit\` asked for. Pass \`offset: ${from + page.length}\` for the ones before these.`
          : more
            ? `${older} older line${older === 1 ? '' : 's'} not shown — pass \`offset: ${from + page.length}\` for the ones before these.`
            : 'This is the whole scrollback ccwt holds.',
        '',
        ...page.map((line) => `${line.service} ${line.stream === 'stderr' ? '!' : '|'} ${line.text}`),
      ],
      {
        worktree: worktree.name,
        service: service ?? null,
        total: wanted.length,
        count: page.length,
        offset: from,
        hasMore: more,
        nextOffset: more ? from + page.length : null,
        capped,
        lines: page.map((line) => ({ service: line.service, stream: line.stream, text: line.text })),
      },
    )
  },
)

server.registerTool(
  named('ccwt_add_project'),
  {
    title: 'Register a repository',
    description:
      'Register a repository with ccwt so it can hold a recipe and manage worktrees for it. Registers the repository the session is in unless a path says otherwise. Writes nothing into the repository. Requires the ccwt dashboard to be running.',
    inputSchema: z.strictObject({
      path: z
        .string()
        .optional()
        .describe(
          'A directory inside the repository to register. Defaults to the working directory; the repository root is resolved from it.',
        ),
    }),
    outputSchema: {
      ...ANSWER,
      rootPath: z.string().optional(),
      registered: z.boolean().optional(),
      hasRecipe: z.boolean().optional(),
    },
    annotations: ACTS,
  },
  async ({ path }): Promise<Told> => {
    const found = await standing(path)
    if ('error' in found) return nope(found.error)

    if (found.project) return nope(`${found.rootPath} is already registered with ccwt.`)

    const result = await request('POST', '/api/projects', { rootPath: found.rootPath })
    if (!answered(result)) return broke(why(result, 'register that repository'))

    return told(
      [
        `Registered ${found.rootPath} with ccwt.`,
        '',
        'It has no recipe, so ccwt cannot create a worktree for it yet. Nothing is detected and',
        'nothing is assumed: read the repository, then store one with ccwt_write_recipe.',
        'ccwt_check_recipe validates a candidate without storing it.',
      ],
      { rootPath: found.rootPath, registered: true, hasRecipe: false },
    )
  },
)

type RecipeIssueLike = IssueLike & { cycle?: string[] }

interface RecipeView {
  source: string
  text: string
  issues?: RecipeIssueLike[]
}

server.registerTool(
  named('ccwt_read_recipe'),
  {
    title: 'The stored recipe',
    description:
      'The recipe ccwt holds for this repository and whether one is stored at all. ccwt detects nothing, so a repository with no stored recipe has none. Read this before writing a recipe: it says whether one already exists and whether a person wrote it.',
    inputSchema: z.strictObject({ path: PATH_ARG }),
    outputSchema: {
      ...ANSWER,
      rootPath: z.string().optional(),
      source: z
        .string()
        .optional()
        .describe('"ccwt" when one is stored, "none" when there is none.'),
      stored: z.boolean().optional(),
      valid: z.boolean().optional(),
      issues: z.array(ISSUE).optional(),
      recipe: z.string().optional().describe('The recipe as JSON text.'),
    },
    annotations: READS,
  },
  async ({ path }): Promise<Told> => {
    const found = await standing(path)
    const missing = needsProject(found)
    if (missing) return nope(missing)
    const at = found as Standing

    const result = await request<RecipeView>('GET', `/api/projects/${at.project!.id}/recipe`)
    if (!answered(result)) return broke(why(result, 'read that recipe'))

    const view = result.body!
    const lines = [`${at.rootPath}`, `Source: ${SOURCES[view.source] ?? view.source}`]

    if (view.issues?.length) {
      lines.push('', 'The stored recipe does not validate:', ...renderIssues(view.issues))
    }
    if (view.source === 'ccwt') {
      lines.push('', 'Something is already stored here. Replacing it needs `replace: true`.')
    } else {
      lines.push(
        '',
        'A worktree of this project gets nothing until a recipe is written. The text below is an',
        'empty recipe to start from, not a suggestion — every field is yours to fill in.',
      )
    }

    lines.push('', view.text)

    return told(lines, {
      rootPath: at.rootPath,
      source: view.source,
      stored: view.source === 'ccwt',
      valid: !view.issues?.length,
      issues: view.issues ?? [],
      recipe: view.text,
    })
  },
)

interface CheckView {
  ok: boolean
  issues?: RecipeIssueLike[]
  notes?: RecipeNoteLike[]
}

server.registerTool(
  named('ccwt_check_recipe'),
  {
    title: 'Validate a recipe',
    description:
      'Validate a candidate recipe without storing it. Returns schema errors with the path of each, plus advisory notes about things that parse but will misbehave — a container stack every worktree would share, an allocated port nothing passes on, a hardlink that would edit the root checkout. Iterate here until it is clean, then write it.',
    inputSchema: z.strictObject({
      recipe: z.string().describe('The whole recipe as JSON text.'),
      path: PATH_ARG,
    }),
    outputSchema: {
      ...ANSWER,
      valid: z.boolean().optional(),
      issues: z.array(ISSUE).optional(),
      notes: z.array(NOTE).optional(),
    },
    annotations: READS,
  },
  async ({ recipe, path }): Promise<Told> => {
    const found = await standing(path)
    const missing = needsProject(found)
    if (missing) return nope(missing)
    const at = found as Standing

    const result = await request<CheckView>(
      'POST',
      `/api/projects/${at.project!.id}/recipe/check`,
      { text: recipe },
    )
    if (!answered(result)) return broke(why(result, 'check that recipe'))

    const check = result.body!

    if (!check.ok) {
      return {
        content: [
          {
            type: 'text' as const,
            text: ['This recipe does not validate. Nothing was stored.', '', ...renderIssues(check.issues)].join('\n'),
          },
        ],
        structuredContent: { ok: false, valid: false, issues: check.issues ?? [], notes: [] },
      }
    }

    return told(['This recipe validates. Nothing was stored.', ...renderNotes(check.notes)], {
      valid: true,
      issues: [],
      notes: check.notes ?? [],
    })
  },
)

server.registerTool(
  named('ccwt_write_recipe'),
  {
    title: 'Store a recipe',
    description:
      "Store a recipe for this repository. It is validated first and nothing is stored if it fails, so the saved recipe never passes through a broken state. It is kept in ccwt's own storage — no file is written into the repository. Replacing a recipe that is already stored needs `replace`.",
    inputSchema: z.strictObject({
      recipe: z.string().describe('The whole recipe as JSON text.'),
      replace: z
        .boolean()
        .optional()
        .describe(
          'Required to overwrite a recipe already stored in ccwt. Read it first and say what changes before setting this.',
        ),
      path: PATH_ARG,
    }),
    outputSchema: {
      ...ANSWER,
      rootPath: z.string().optional(),
      stored: z.boolean().optional(),
      replaced: z.boolean().optional(),
      notes: z.array(NOTE).optional(),
    },
    annotations: { ...ACTS, destructiveHint: true },
  },
  async ({ recipe, replace, path }): Promise<Told> => {
    const found = await standing(path)
    const missing = needsProject(found)
    if (missing) return nope(missing)
    const at = found as Standing
    const id = at.project!.id

    const existing = await request<RecipeView>('GET', `/api/projects/${id}/recipe`)
    if (answered(existing) && existing.body!.source === 'ccwt' && replace !== true) {
      return nope([
        'A recipe is already stored for this repository, and a person may have written it.',
        'Read it with ccwt_read_recipe, say what would change, and pass `replace: true` to go ahead.',
      ])
    }

    const checked = await request<CheckView>('POST', `/api/projects/${id}/recipe/check`, {
      text: recipe,
    })
    if (!answered(checked)) return broke(why(checked, 'check that recipe'))

    if (!checked.body!.ok) {
      return nope([
        'This recipe does not validate, so nothing was stored.',
        '',
        ...renderIssues(checked.body!.issues),
      ])
    }

    const written = await request('PUT', `/api/projects/${id}/recipe`, { text: recipe })
    if (!answered(written)) return broke(why(written, 'store that recipe'))

    return told(
      [
        `Stored the recipe for ${at.rootPath}. It lives in ccwt's own storage; nothing was written into the repository.`,
        'It takes effect on the next worktree ccwt creates. Worktrees that already exist keep what they have.',
        ...renderNotes(checked.body!.notes),
      ],
      {
        rootPath: at.rootPath,
        stored: true,
        replaced: replace === true,
        notes: checked.body!.notes ?? [],
      },
    )
  },
)

server.registerTool(
  named('ccwt_create_worktree'),
  {
    title: 'Create a worktree',
    description:
      "Create a worktree of this repository and provision it from the recipe — place the declared files, hardlink what the recipe links, run `postCreate`, allocate a port per service. It arrives ready and stopped. This is how a recipe gets tested, since a recipe only ever takes effect on a worktree created after it was stored. Do not use `git worktree add` and set one up by hand: ccwt hardlinks `node_modules` where an install would duplicate it.",
    inputSchema: z.strictObject({
      name: z
        .string()
        .min(1)
        .describe(
          "Name for the worktree. It becomes the directory name under the recipe's `worktreesDir`, and the branch name unless `branch` says otherwise.",
        ),
      branch: z
        .string()
        .optional()
        .describe('An existing branch to check out. Defaults to a new branch named after the worktree.'),
      start: z
        .boolean()
        .optional()
        .describe(
          'Start every service once it is provisioned. Off by default — a provisioned worktree costs nothing, a dev server nobody asked for costs a port and a process.',
        ),
      path: PATH_ARG,
    }),
    outputSchema: {
      ...ANSWER,
      ...WORKTREE,
      created: z.boolean().optional(),
      started: z.boolean().optional(),
    },
    annotations: { ...ACTS, idempotentHint: false },
  },
  async ({ name, branch, start, path }): Promise<Told> => {
    if (!name.trim()) return broke('`name` cannot be blank.')

    const found = await standing(path)
    const missing = needsProject(found)
    if (missing) return nope(missing)
    const at = found as Standing

    const created = await request<WorktreeLike>(
      'POST',
      `/api/projects/${at.project!.id}/worktrees`,
      { name, branch: branch ?? '', start: start === true },
      PLACE_MS,
    )
    if (!answered(created)) return broke(why(created, 'create that worktree'))

    const worktree = created.body!

    return told(
      [
        'Created and provisioned:',
        ...describeWorktree(worktree),
        '',
        ...(start === true
          ? ['Its services were started. Call ccwt_get_status to see where they landed.']
          : [
              'It is provisioned and stopped. Start it with ccwt_start_worktree, then check the service',
              'answers on the URL rather than trusting the port — see the ccwt-worktree-verify skill.',
            ]),
        'ccwt_get_logs with `service: "provision"` says what was placed, linked and run.',
      ],
      { created: true, started: start === true, ...shapeWorktree(worktree) },
    )
  },
)

server.registerTool(
  named('ccwt_provision_worktree'),
  {
    title: 'Repair a worktree',
    description:
      "Put back whatever the recipe names and a worktree is missing — files only. Use it after adding a `copy`, `link` or `write` entry, so an existing worktree picks it up without being recreated. It never runs `postCreate`: those commands generate keys, seed databases and build, and a worktree that already exists is not ccwt's to rebuild. If what changed was an install, the worktree has to be created again.",
    inputSchema: z.strictObject({
      worktree: z
        .string()
        .optional()
        .describe('Name of the worktree to repair. Defaults to the one the session is in.'),
      refresh: z
        .boolean()
        .optional()
        .describe(
          'Replace what is already there rather than only filling gaps — for a linked path that has drifted from the root checkout.',
        ),
      path: PATH_ARG,
    }),
    outputSchema: { ...ANSWER, ...WORKTREE, refreshed: z.boolean().optional() },
    annotations: ACTS,
  },
  async ({ worktree, refresh, path }): Promise<Told> => {
    const found = await standing(path)
    const missing = needsProject(found)
    if (missing) return nope(missing)
    const at = found as Standing

    const picked = await pick(at, worktree, 'repair')
    if ('error' in picked) return broke(picked.error)

    const done = await request<WorktreeLike>(
      'POST',
      `/api/projects/${at.project!.id}/worktrees/${picked.chosen.id}/provision`,
      { refresh: refresh === true },
      PLACE_MS,
    )
    if (!answered(done)) return broke(why(done, 'provision that worktree'))

    const landed = done.body ?? picked.chosen

    return told(
      [
        'Provisioned what was missing:',
        ...describeWorktree(landed),
        '',
        'Files only — `postCreate` was not run, so an install the recipe added is not here. ccwt_get_logs',
        'with `service: "provision"` says what was placed, and what it refused to place.',
      ],
      { refreshed: refresh === true, ...shapeWorktree(landed) },
    )
  },
)

server.registerTool(
  named('ccwt_start_worktree'),
  {
    title: 'Start a worktree',
    description:
      "Ask ccwt to start the services it declares for a worktree — the worktree the session is in unless one is named. ccwt still owns the lifecycle: it allocates the port, repairs anything missing from the recipe, spawns the process group and probes the port. Use this instead of running a dev server yourself. A service that is already up is left alone and nothing is re-applied, so stop it first if the recipe changed.",
    inputSchema: z.strictObject({
      service: z
        .string()
        .optional()
        .describe('Which service to start, as ccwt_get_status reports it. Omit to start all of them.'),
      worktree: z
        .string()
        .optional()
        .describe('Name of the worktree to start. Defaults to the one the session is in.'),
      path: PATH_ARG,
    }),
    outputSchema: {
      ...ANSWER,
      worktree: z.string().optional(),
      path: z.string().optional(),
      settling: z
        .boolean()
        .optional()
        .describe('True while a service is still proving it stays alive.'),
      alreadyRunning: z
        .array(z.string())
        .optional()
        .describe('Services left untouched because they were already up. Nothing was re-applied to these.'),
      services: z.array(SERVICE).optional(),
    },
    annotations: ACTS,
  },
  async ({ service, worktree, path }): Promise<Told> => {
    const found = await standing(path)
    const missing = needsProject(found)
    if (missing) return nope(missing)
    const at = found as Standing

    const picked = await pick(at, worktree, 'start')
    if ('error' in picked) return broke(picked.error)

    const wanted = picked.chosen
    const problem = serviceProblem(wanted, service)
    if (problem) return nope(problem)

    const already = (service ? wanted.services.filter((entry) => entry.name === service) : wanted.services)
      .filter((entry) => entry.state === 'running' || entry.state === 'starting')
      .map((entry) => entry.name)

    const id = at.project!.id
    const route = service
      ? `/api/projects/${id}/worktrees/${wanted.id}/services/${encodeURIComponent(service)}/start`
      : `/api/projects/${id}/worktrees/${wanted.id}/services/start`

    const started = await request<ServiceLike | ServiceLike[]>('POST', route, {}, PLACE_MS)
    if (!answered(started)) return broke(why(started, 'start that service'))

    const statuses = (Array.isArray(started.body) ? started.body : [started.body!]).filter(Boolean)
    const settling = statuses.some((status) => status.state === 'starting')

    return told(
      [
        `${wanted.name} — ${service ? `started \`${service}\`` : 'started every service'}:`,
        ...statuses.map(describeService),
        ...(already.length
          ? [
              '',
              `${already.join(', ')} ${already.length > 1 ? 'were' : 'was'} already up, so ${already.length > 1 ? 'they were' : 'it was'} left alone — nothing was re-applied. A recipe is read when a service starts, so stop it with ccwt_stop_worktree first if you changed one.`,
            ]
          : []),
        ...(settling
          ? [
              '',
              'A service goes to running once it has stayed alive briefly. Call ccwt_get_status again to see where it landed, and ccwt_get_logs if it did not.',
            ]
          : []),
      ],
      {
        worktree: wanted.name,
        path: wanted.path,
        settling,
        alreadyRunning: already,
        services: statuses.map(shapeService),
      },
    )
  },
)

server.registerTool(
  named('ccwt_stop_worktree'),
  {
    title: 'Stop a worktree',
    description:
      "Ask ccwt to stop the services it runs for a worktree. It kills the process group, so nothing is left holding the port, and a stack's own `stopCommand` runs. The port is freed and the worktree kept — nothing is deleted. This is also how a changed recipe reaches a service that is already up: a recipe is read when a service starts, and starting one that is already running re-applies nothing.",
    inputSchema: z.strictObject({
      service: z
        .string()
        .optional()
        .describe('Which service to stop, as ccwt_get_status reports it. Omit to stop all of them.'),
      worktree: z
        .string()
        .optional()
        .describe('Name of the worktree to stop. Defaults to the one the session is in.'),
      path: PATH_ARG,
    }),
    outputSchema: {
      ...ANSWER,
      worktree: z.string().optional(),
      path: z.string().optional(),
      services: z.array(SERVICE).optional(),
    },
    annotations: ACTS,
  },
  async ({ service, worktree, path }): Promise<Told> => {
    const found = await standing(path)
    const missing = needsProject(found)
    if (missing) return nope(missing)
    const at = found as Standing

    const picked = await pick(at, worktree, 'stop')
    if ('error' in picked) return broke(picked.error)

    const wanted = picked.chosen
    const problem = serviceProblem(wanted, service)
    if (problem) return nope(problem)

    const id = at.project!.id
    const route = service
      ? `/api/projects/${id}/worktrees/${wanted.id}/services/${encodeURIComponent(service)}/stop`
      : `/api/projects/${id}/worktrees/${wanted.id}/services/stop`

    const stopped = await request<ServiceLike | ServiceLike[]>('POST', route, {}, PLACE_MS)
    if (!answered(stopped)) return broke(why(stopped, 'stop that service'))

    const statuses = (Array.isArray(stopped.body) ? stopped.body : [stopped.body!]).filter(Boolean)

    return told(
      [
        `${wanted.name} — ${service ? `stopped \`${service}\`` : 'stopped every service'}:`,
        ...statuses.map(describeService),
        '',
        'The worktree and its files are untouched. Starting it again re-reads the recipe.',
      ],
      { worktree: wanted.name, path: wanted.path, services: statuses.map(shapeService) },
    )
  },
)

if (process.argv[2] === '--tools') {
  process.stdout.write(JSON.stringify(NAMES))
  process.exit(0)
}

await server.connect(new StdioServerTransport())
