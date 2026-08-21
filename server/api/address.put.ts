import { writeAddress } from '~~/server/lib/address'
import { describeAddress } from '~~/server/lib/address-view'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ port?: number }>(event)

  if (typeof body?.port !== 'number') {
    throw createError({ statusCode: 400, statusMessage: 'port is required' })
  }

  return guard(async () => {
    await writeAddress({ port: body.port! })
    return describeAddress()
  })
})
