import * as supervisor from '~~/server/lib/supervisor'

export default defineEventHandler(async (event) => {
  await requireProject(event)
  const worktreeId = getRouterParam(event, 'worktreeId')!
  const service = getQuery(event).service

  if (typeof service === 'string' && service) supervisor.forgetService(worktreeId, service)
  else supervisor.forgetScrollback(worktreeId)

  return null
})
