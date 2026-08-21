import { asRows, forgetMark, writeMark } from '~~/server/lib/sessions'

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
    asRows(body?.rows) ?? {},
    typeof body?.title === 'string' ? body.title : undefined,
  )

  return { ok: true }
})
