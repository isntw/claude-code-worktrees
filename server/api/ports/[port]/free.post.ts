import type { H3Event } from 'h3'
import * as holders from '~~/server/lib/holders'

interface Body {
  pids?: unknown
  services?: unknown
}

function pidsOf(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (pid): pid is number => typeof pid === 'number' && Number.isInteger(pid) && pid > 1,
  )
}

function servicesOf(value: unknown): { worktreeId: string; service: string }[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const candidate = entry as { worktreeId?: unknown; service?: unknown }
    if (typeof candidate.worktreeId !== 'string' || typeof candidate.service !== 'string') return []
    return [{ worktreeId: candidate.worktreeId, service: candidate.service }]
  })
}

function servedOn(event: H3Event): number | null {
  const host = getRequestHost(event)
  const mark = host.lastIndexOf(':')
  if (mark === -1) return null

  const port = Number.parseInt(host.slice(mark + 1), 10)
  return Number.isInteger(port) ? port : null
}

export default defineEventHandler(async (event) => {
  const raw = getRouterParam(event, 'port')!
  const body = await readBody<Body>(event).catch(() => ({}) as Body)

  return guard(async () => {
    const port = Number.parseInt(raw, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${raw} is not a port number.`)
    }

    if (port === servedOn(event)) {
      throw new Error(`Port ${port} is the one ccwt is serving this page on.`)
    }

    const pids = pidsOf(body.pids)
    const services = servicesOf(body.services)

    if (!pids.length && !services.length) {
      throw new Error('Nothing to stop was named, so nothing was signalled.')
    }

    return holders.free(port, { pids, services })
  })
})
