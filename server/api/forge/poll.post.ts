import * as forge from '~~/server/lib/forge'
import * as forgeauth from '~~/server/lib/forgeauth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ handle?: unknown }>(event)
  const handle = typeof body?.handle === 'string' ? body.handle : null

  if (!handle) {
    throw createError({ statusCode: 400, statusMessage: 'A sign-in handle is required' })
  }

  return guard(async () => {
    const outcome = await forgeauth.poll(handle)
    if (outcome.state === 'done') forge.forgetAll()
    return outcome
  })
})
