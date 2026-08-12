import * as supervisor from '~~/server/lib/supervisor'

export default defineEventHandler(async (event) => {
  await requireProject(event)
  const worktreeId = getRouterParam(event, 'worktreeId')!
  const service = getRouterParam(event, 'service')!

  return guard(() => supervisor.stop(worktreeId, service))
})
