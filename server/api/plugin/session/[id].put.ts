import { forgetMark, writeMark } from '~~/server/lib/sessions'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A session id is required.' })

  const body = await readBody<{ rows?: unknown; title?: unknown; done?: unknown }>(event)

  if (body?.done === true) {
    await forgetMark(id)
    return { ok: true }
  }

  await writeMark(
    id,
    Array.isArray(body?.rows) ? body.rows : [],
    typeof body?.title === 'string' ? body.title : undefined,
  )

  return { ok: true }
})
