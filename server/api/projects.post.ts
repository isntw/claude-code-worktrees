import * as projects from '~~/server/lib/projects'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ rootPath?: string }>(event)
  const rootPath = body?.rootPath?.trim()

  if (!rootPath) {
    throw createError({ statusCode: 400, statusMessage: 'rootPath is required' })
  }

  return guard(() => projects.register(rootPath))
})
