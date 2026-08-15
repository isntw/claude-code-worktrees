import * as worktrees from '~~/server/lib/worktrees'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const worktreeId = getRouterParam(event, 'worktreeId')!
  const alsoBranch = getQuery(event).branch === 'true'

  return guard(() => worktrees.remove(project, worktreeId, alsoBranch))
})
