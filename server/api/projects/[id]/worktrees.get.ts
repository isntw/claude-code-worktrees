import { findProject } from '../../../lib/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const project = await findProject(id)

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'No such project' })
  }

  return []
})
