import * as worktrees from '~~/server/lib/worktrees'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const body = await readBody<{ refresh?: boolean }>(event).catch(() => null)

  return guard(() => worktrees.repairAll(project, body?.refresh === true))
})
