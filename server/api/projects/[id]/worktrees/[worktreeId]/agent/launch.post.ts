import { launchSession } from '~~/server/lib/claude'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const worktreeId = getRouterParam(event, 'worktreeId')!

  return guard(() =>
    launchSession(worktreeId, project.config?.claude.launchCommand ?? 'claude'),
  )
})
