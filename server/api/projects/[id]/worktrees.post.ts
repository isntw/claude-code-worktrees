import { addWorktree } from '../../../lib/git'
import { findProject } from '../../../lib/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ name?: string; branch?: string; start?: boolean }>(event)

  if (!body?.name) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }

  const project = await findProject(id)
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'No such project' })
  }

  return guard(() => addWorktree(project.rootPath, body.name!, body.branch ?? body.name!))
})
