import { writeAddress } from '~~/server/lib/address'
import { describeAddress } from '~~/server/lib/address-view'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ host?: string; port?: number }>(event)

  if (typeof body?.host !== 'string' || typeof body?.port !== 'number') {
    throw createError({ statusCode: 400, statusMessage: 'host and port are required' })
  }

  return guard(async () => {
    await writeAddress({ host: body.host!, port: body.port! })
    return describeAddress()
  })
})
