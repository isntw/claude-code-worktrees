#!/usr/bin/env node
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { call as request, describe, locate, reachServer } from '../lib/discover.mjs'

const NAME = 'ccwt'
const VERSION = '0.2.0'
const PROTOCOL = '2025-06-18'
const TAIL = 100

const TOOLS = [
  {
    name: 'ccwt_status',
    description:
      'What ccwt runs for the current repository: every worktree, its services, the port each is assigned, and whether that port is answering right now. Answers even when the ccwt dashboard is closed. Use this instead of starting a dev server to find out what is up.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'A directory inside the repository to report on. Defaults to the working directory the server was started in — pass the worktree path when the session has moved.',
        },
      },
    },
  },
  {
    name: 'ccwt_logs',
    description:
      "A ccwt-managed service's recent output, so a change can be checked without starting or building anything. Requires the ccwt dashboard to be running.",
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Service name, as ccwt_status reports it. Omit for every service.',
        },
        path: {
          type: 'string',
          description: 'A directory inside the worktree whose logs are wanted.',
        },
        tail: {
          type: 'number',
          description: `How many of the most recent lines to return. Defaults to ${TAIL}.`,
        },
      },
    },
  },
  {
    name: 'ccwt_project_add',
    description:
      'Register a repository with ccwt so it can hold a recipe and manage worktrees for it. Registers the repository the session is in unless a path says otherwise. Writes nothing into the repository. Requires the ccwt dashboard to be running.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'A directory inside the repository to register. Defaults to the working directory; the repository root is resolved from it.',
        },
      },
    },
  },
  {
    name: 'ccwt_recipe_read',
    description:
      "The recipe ccwt holds for this repository, where it came from — a recipe stored in ccwt, or nothing but detection — and whether it has gone stale. Read this before writing a recipe: it says whether one already exists and whether a person wrote it.",
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'A directory inside the repository. Defaults to the working directory.',
        },
      },
    },
  },
  {
    name: 'ccwt_recipe_check',
    description:
      'Validate a candidate recipe without storing it. Returns schema errors with the path of each, plus advisory notes about things that parse but will misbehave — a container stack every worktree would share, an allocated port nothing passes on, a hardlink that would edit the root checkout. Iterate here until it is clean, then write it.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe: {
          type: 'string',
          description: 'The whole recipe as JSON text.',
        },
        path: {
          type: 'string',
          description: 'A directory inside the repository. Defaults to the working directory.',
        },
      },
      required: ['recipe'],
    },
  },
  {
    name: 'ccwt_recipe_write',
    description:
      "Store a recipe for this repository. It is validated first and nothing is stored if it fails, so the saved recipe never passes through a broken state. It is kept in ccwt's own storage — no file is written into the repository. Replacing a recipe that is already stored needs `replace`.",
    inputSchema: {
      type: 'object',
      properties: {
        recipe: {
          type: 'string',
          description: 'The whole recipe as JSON text.',
        },
        replace: {
          type: 'boolean',
          description:
            'Required to overwrite a recipe already stored in ccwt. Read it first and say what changes before setting this.',
        },
        path: {
          type: 'string',
          description: 'A directory inside the repository. Defaults to the working directory.',
        },
      },
      required: ['recipe'],
    },
  },
  {
    name: 'ccwt_worktree_start',
    description:
      "Ask ccwt to start the services it declares for a worktree — the worktree the session is in unless one is named. ccwt still owns the lifecycle: it allocates the port, repairs anything missing from the recipe, spawns the process group and probes the port. Use this instead of running a dev server yourself. Starts only; stopping and restarting stay in the dashboard.",
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Which service to start, as ccwt_status reports it. Omit to start all of them.',
        },
        worktree: {
          type: 'string',
          description: "Name of the worktree to start. Defaults to the one the session is in.",
        },
        path: {
          type: 'string',
          description: 'A directory inside the repository. Defaults to the working directory.',
        },
      },
    },
  },
]

if (process.argv[2] === '--tools') {
  process.stdout.write(JSON.stringify(TOOLS.map((tool) => tool.name)))
  process.exit(0)
}

const text = (body) => ({ content: [{ type: 'text', text: body }] })

async function status(args) {
  const found = await describe(args?.path ?? process.cwd()).catch(() => null)
  if (!found) return text('This directory is not inside a repository ccwt manages.')

  const lines = [`${found.projectName} — ${found.rootPath}`, '']

  for (const worktree of found.worktrees) {
    const services = worktree.services.map((service) => {
      if (service.port === null) return `    ${service.name}: no port allocated`
      return `    ${service.name}: port ${service.port} — ${service.up ? `running at http://localhost:${service.port}` : 'stopped'}`
    })
    lines.push(`  ${worktree.name}${worktree.root ? ' (root)' : ''}`, ...services)
  }

  lines.push(
    '',
    'ccwt owns these services. Open a URL rather than starting your own copy, and use',
    'ccwt_worktree_start to bring one up. Stopping and restarting are done from the ccwt dashboard.',
  )

  return text(lines.join('\n'))
}

async function logs(args) {
  const found = await describe(args?.path ?? process.cwd()).catch(() => null)
  if (!found) return text('This directory is not inside a repository ccwt manages.')

  const worktree = found.here
  if (!worktree) {
    const named = found.worktrees
      .filter((entry) => entry.services.some((service) => service.port !== null))
      .map((entry) => entry.path)

    return text(
      named.length
        ? `This directory is not one of ccwt's worktrees. Name the one you mean with \`path\`:\n${named.join('\n')}`
        : 'This directory is not one of ccwt’s worktrees, and none of this repository’s worktrees has a service.',
    )
  }

  const server = await reachServer()
  if (!server) {
    return text(
      'ccwt is not running, so its logs are not reachable. Start the ccwt dashboard and try again — ccwt keeps a service’s output only while it is running.',
    )
  }

  const url = `${server.origin}/api/projects/${found.projectId}/worktrees/${worktree.id}/logs`
  const response = await fetch(url, { headers: { 'x-ccwt-token': server.token } }).catch(
    () => null,
  )

  if (!response || !response.ok) {
    return text(`ccwt refused the request for ${worktree.name} logs (${response?.status ?? 'no response'}).`)
  }

  const all = await response.json().catch(() => null)
  if (!Array.isArray(all)) return text('ccwt returned no readable log data.')

  const wanted = args?.service ? all.filter((line) => line.service === args.service) : all
  if (!wanted.length) {
    return text(
      `No output recorded for ${args?.service ? `\`${args.service}\` in ` : ''}${worktree.name}. ccwt keeps a service's scrollback only while that service is running.`,
    )
  }

  const tail = wanted.slice(-(args?.tail ?? TAIL))
  const body = tail.map((line) => `${line.service} ${line.stream === 'stderr' ? '!' : '|'} ${line.text}`)

  return text(
    [
      `${worktree.name} — last ${tail.length} of ${wanted.length} lines`,
      'Pass `path` if you meant a different worktree.',
      '',
      ...body,
    ].join('\n'),
  )
}

const NO_SERVER =
  'ccwt is not running, so its recipe store is not reachable. Start the ccwt dashboard and try again.'

const SOURCES = {
  ccwt: 'a recipe stored in ccwt',
  detected: 'nothing stored — this is only what detection guessed',
}

async function place(args) {
  const found = await locate(args?.path ?? process.cwd())
  if (!found) return { error: 'This directory is not inside a git repository.' }
  if (!found.reachable) return { error: NO_SERVER }
  return found
}

function why(result, what) {
  if (!result.server) return NO_SERVER
  if (result.ok && result.body === null) {
    return `ccwt answered the request to ${what} with something that is not JSON, which is what an older ccwt does with a route it does not have. Update ccwt so it matches this plugin.`
  }
  const said = result.body?.message || result.body?.statusMessage
  return `ccwt refused to ${what} (${result.status || 'no response'})${said ? `: ${said}` : ''}.`
}

const answered = (result) => result.ok && result.body !== null

function renderNotes(notes) {
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

function renderIssues(issues) {
  return (issues ?? []).map((issue) => `  ${issue.path}: ${issue.message}`)
}

async function projectAdd(args) {
  const found = await place(args)
  if (found.error) return text(found.error)

  if (found.project) {
    return text(`${found.rootPath} is already registered with ccwt.`)
  }

  const result = await request('POST', '/api/projects', { rootPath: found.rootPath })
  if (!answered(result)) return { ...text(why(result, 'register that repository')), isError: true }

  return text(
    [
      `Registered ${found.rootPath} with ccwt.`,
      '',
      'It has no recipe yet, so ccwt falls back to what it can detect — which is Node-shaped and',
      'finds nothing for most other stacks. Write one with ccwt_recipe_write.',
    ].join('\n'),
  )
}

async function recipeRead(args) {
  const found = await place(args)
  if (found.error) return text(found.error)
  if (!found.project) {
    return text(
      `${found.rootPath} is not registered with ccwt. Register it with ccwt_project_add first.`,
    )
  }

  const result = await request('GET', `/api/projects/${found.project.id}/recipe`)
  if (!answered(result)) return { ...text(why(result, 'read that recipe')), isError: true }

  const view = result.body
  const lines = [
    `${found.rootPath}`,
    `Source: ${SOURCES[view.source] ?? view.source}${view.path ? ` (${view.path})` : ''}`,
  ]

  if (view.stale) {
    lines.push('This recipe predates the current detection, so ccwt marks it stale. It is never migrated for you.')
  }
  if (view.issues?.length) {
    lines.push('', 'It does not validate:', ...renderIssues(view.issues))
  }
  if (view.source === 'ccwt') {
    lines.push('', 'Something is already stored here. Replacing it needs `replace: true`.')
  }

  lines.push('', view.text)
  return text(lines.join('\n'))
}

async function recipeCheck(args) {
  if (typeof args?.recipe !== 'string') return { ...text('`recipe` is required.'), isError: true }

  const found = await place(args)
  if (found.error) return text(found.error)
  if (!found.project) {
    return text(
      `${found.rootPath} is not registered with ccwt. Register it with ccwt_project_add first.`,
    )
  }

  const result = await request('POST', `/api/projects/${found.project.id}/recipe/check`, {
    text: args.recipe,
  })
  if (!answered(result)) return { ...text(why(result, 'check that recipe')), isError: true }

  const check = result.body

  if (!check.ok) {
    return text(['This recipe does not validate. Nothing was stored.', '', ...renderIssues(check.issues)].join('\n'))
  }

  return text(
    ['This recipe validates. Nothing was stored.', ...renderNotes(check.notes)].join('\n'),
  )
}

async function recipeWrite(args) {
  if (typeof args?.recipe !== 'string') return { ...text('`recipe` is required.'), isError: true }

  const found = await place(args)
  if (found.error) return text(found.error)
  if (!found.project) {
    return text(
      `${found.rootPath} is not registered with ccwt. Register it with ccwt_project_add first.`,
    )
  }

  const id = found.project.id

  const existing = await request('GET', `/api/projects/${id}/recipe`)
  if (answered(existing) && existing.body.source === 'ccwt' && args.replace !== true) {
    return text(
      [
        'A recipe is already stored for this repository, and a person may have written it.',
        'Read it with ccwt_recipe_read, say what would change, and pass `replace: true` to go ahead.',
      ].join('\n'),
    )
  }

  const checked = await request('POST', `/api/projects/${id}/recipe/check`, { text: args.recipe })
  if (!answered(checked)) return { ...text(why(checked, 'check that recipe')), isError: true }

  if (!checked.body.ok) {
    return text(
      ['This recipe does not validate, so nothing was stored.', '', ...renderIssues(checked.body.issues)].join('\n'),
    )
  }

  const written = await request('PUT', `/api/projects/${id}/recipe`, { text: args.recipe })
  if (!answered(written)) return { ...text(why(written, 'store that recipe')), isError: true }

  return text(
    [
      `Stored the recipe for ${found.rootPath}. It lives in ccwt's own storage; nothing was written into the repository.`,
      'It takes effect on the next worktree ccwt creates. Worktrees that already exist keep what they have.',
      ...renderNotes(checked.body.notes),
    ].join('\n'),
  )
}

function describeService(status) {
  const where = status.url ? ` at ${status.url}` : status.port ? ` on port ${status.port}` : ''
  const failed = status.state === 'crashed' && status.exitCode !== null ? ` (exit ${status.exitCode})` : ''
  return `  ${status.name}: ${status.state}${where}${failed}`
}

async function worktreeStart(args) {
  const found = await place(args)
  if (found.error) return text(found.error)
  if (!found.project) {
    return text(
      `${found.rootPath} is not registered with ccwt. Register it with ccwt_project_add first.`,
    )
  }

  const id = found.project.id
  const listed = await request('GET', `/api/projects/${id}/worktrees`)
  if (!answered(listed)) return { ...text(why(listed, 'list this repository’s worktrees')), isError: true }

  const all = Array.isArray(listed.body) ? listed.body : []
  const wanted = args?.worktree
    ? all.find((entry) => entry.name === args.worktree)
    : all.find((entry) => resolve(entry.path) === resolve(found.here))

  if (!wanted) {
    const named = all.map((entry) => `  ${entry.name} — ${entry.path}`)
    return text(
      args?.worktree
        ? `This repository has no worktree called \`${args.worktree}\`.\n${named.join('\n')}`
        : `This directory is not one of ccwt’s worktrees. Name the one you mean with \`worktree\`:\n${named.join('\n')}`,
    )
  }

  if (!wanted.services.length) {
    return text(
      `${wanted.name} has no services — the recipe for this repository declares none. Write one with ccwt_recipe_write.`,
    )
  }

  if (args?.service && !wanted.services.some((entry) => entry.name === args.service)) {
    return text(
      `\`${args.service}\` is not a service in this recipe. It declares: ${wanted.services.map((entry) => entry.name).join(', ')}.`,
    )
  }

  const route = args?.service
    ? `/api/projects/${id}/worktrees/${wanted.id}/services/${encodeURIComponent(args.service)}/start`
    : `/api/projects/${id}/worktrees/${wanted.id}/services/start`

  const started = await request('POST', route, {})
  if (!answered(started)) return { ...text(why(started, 'start that service')), isError: true }

  const statuses = Array.isArray(started.body) ? started.body : [started.body]
  const settling = statuses.some((status) => status?.state === 'starting')

  return text(
    [
      `${wanted.name} — ${args?.service ? `started \`${args.service}\`` : 'started every service'}:`,
      ...statuses.filter(Boolean).map(describeService),
      ...(settling
        ? ['', 'A service goes to running once it has stayed alive briefly. Call ccwt_status again to see where it landed, and ccwt_logs if it did not.']
        : []),
    ].join('\n'),
  )
}

async function call(name, args) {
  if (name === 'ccwt_status') return status(args)
  if (name === 'ccwt_logs') return logs(args)
  if (name === 'ccwt_project_add') return projectAdd(args)
  if (name === 'ccwt_recipe_read') return recipeRead(args)
  if (name === 'ccwt_recipe_check') return recipeCheck(args)
  if (name === 'ccwt_recipe_write') return recipeWrite(args)
  if (name === 'ccwt_worktree_start') return worktreeStart(args)
  return { ...text(`No such tool: ${name}`), isError: true }
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

async function handle(request) {
  const { method, params } = request

  if (method === 'initialize') {
    return {
      protocolVersion: params?.protocolVersion ?? PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: NAME, version: VERSION },
    }
  }

  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: TOOLS }
  if (method === 'tools/call') return call(params?.name, params?.arguments)

  const error = new Error(`Method not found: ${method}`)
  error.code = -32601
  throw error
}

const lines = createInterface({ input: process.stdin })

for await (const line of lines) {
  if (!line.trim()) continue

  let request
  try {
    request = JSON.parse(line)
  } catch {
    continue
  }

  if (request.id === undefined) continue

  try {
    send({ jsonrpc: '2.0', id: request.id, result: await handle(request) })
  } catch (cause) {
    send({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: cause.code ?? -32603, message: cause.message ?? 'Internal error' },
    })
  }
}
