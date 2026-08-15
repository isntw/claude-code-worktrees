import * as forge from '~~/server/lib/forge'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const number = Number.parseInt(getRouterParam(event, 'number') ?? '', 10)

  if (!Number.isInteger(number) || number <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A pull request number is required' })
  }

  return guard(() => forge.mergeability(project.rootPath, number))
})
