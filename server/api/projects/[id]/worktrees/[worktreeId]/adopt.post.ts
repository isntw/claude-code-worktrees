import { classify } from '../../../../../lib/git'
import { findProject } from '../../../../../lib/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const project = await findProject(id)
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'No such project' })
  }

  return guard(() =>
    classify(project.rootPath, {
      path: getRouterParam(event, 'worktreeId')!,
      head: null,
      branch: null,
      bare: false,
      detached: false,
      locked: false,
      lockReason: null,
      prunable: false,
    }),
  )
})
