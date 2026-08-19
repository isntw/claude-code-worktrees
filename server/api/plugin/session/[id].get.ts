import { readMark } from '~~/server/lib/sessions'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A session id is required.' })

  return (await readMark(id)) ?? {}
})
