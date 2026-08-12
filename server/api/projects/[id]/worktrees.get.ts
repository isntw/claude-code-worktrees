import * as worktrees from '~~/server/lib/worktrees'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  return guard(() => worktrees.list(project))
})
