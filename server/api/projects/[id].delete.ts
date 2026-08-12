import * as projects from '~~/server/lib/projects'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  if (!(await projects.forget(id))) {
    throw createError({ statusCode: 404, statusMessage: 'No such project' })
  }

  setResponseStatus(event, 204)
  return null
})
