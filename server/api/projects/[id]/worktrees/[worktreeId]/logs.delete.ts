import * as supervisor from '~~/server/lib/supervisor'

export default defineEventHandler(async (event) => {
  await requireProject(event)
  const worktreeId = getRouterParam(event, 'worktreeId')!

  supervisor.forgetScrollback(worktreeId)
  return null
})
