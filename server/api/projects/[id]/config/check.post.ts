import { checkConfig } from '~~/server/lib/config'

export default defineEventHandler(async (event) => {
  await requireProject(event)
  const body = await readBody<{ text?: string }>(event)

  if (typeof body?.text !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'text is required' })
  }

  return guard(() => checkConfig(body.text!))
})
