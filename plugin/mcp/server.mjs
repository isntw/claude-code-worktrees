#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { describe, reachServer } from '../lib/discover.mjs'

const NAME = 'ccwt'
const VERSION = '0.1.0'
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
]

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
    lines.push(
      `  ${worktree.name}${worktree.root ? ' (root)' : ''}${worktree.id === found.here?.id ? '  ← this session' : ''}`,
      ...services,
    )
  }

  lines.push(
    '',
    'ccwt owns these services. Open a URL rather than starting your own copy; starting, stopping',
    'and restarting one is done from the ccwt dashboard.',
  )

  return text(lines.join('\n'))
}

async function logs(args) {
  const found = await describe(args?.path ?? process.cwd()).catch(() => null)
  if (!found) return text('This directory is not inside a repository ccwt manages.')

  const worktree = found.here ?? found.worktrees.find((entry) => !entry.root)
  if (!worktree) return text('No worktree here to read logs for.')

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

  return text([`${worktree.name} — last ${tail.length} of ${wanted.length} lines`, '', ...body].join('\n'))
}

async function call(name, args) {
  if (name === 'ccwt_status') return status(args)
  if (name === 'ccwt_logs') return logs(args)
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
