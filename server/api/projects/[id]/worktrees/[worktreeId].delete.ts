import { isLocked, removeWorktree } from '../../../../lib/git'
import { findProject } from '../../../../lib/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const worktreeId = getRouterParam(event, 'worktreeId')!

  const project = await findProject(id)
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'No such project' })
  }

  return guard(async () => {
    if (await isLocked(worktreeId)) {
      throw createError({ statusCode: 409, statusMessage: 'An agent is working here' })
    }
    await removeWorktree(project.rootPath, worktreeId)
  })
})
