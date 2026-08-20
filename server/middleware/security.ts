import { decide } from '~~/server/lib/access'

const REFUSALS = {
  'bad-host': { statusCode: 403, statusMessage: 'Host not allowed' },
  'cross-site': { statusCode: 403, statusMessage: 'Cross-site request refused' },
  'cross-origin': { statusCode: 403, statusMessage: 'Cross-origin request refused' },
  unauthorized: { statusCode: 401, statusMessage: 'Unauthorized' },
} as const

export default defineEventHandler(async (event) => {
  const verdict = decide(
    {
      path: event.path,
      method: event.method,
      host: getRequestHeader(event, 'host'),
      site: getRequestHeader(event, 'sec-fetch-site'),
      origin: getRequestHeader(event, 'origin'),
      offered: getRequestHeader(event, 'x-ccwt-token'),
    },
    useRuntimeConfig(event).token,
  )

  if (verdict === 'allow') return

  throw createError(REFUSALS[verdict])
})
