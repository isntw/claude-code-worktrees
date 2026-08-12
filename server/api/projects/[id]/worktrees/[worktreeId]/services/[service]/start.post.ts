import * as worktrees from '~~/server/lib/worktrees'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const worktreeId = getRouterParam(event, 'worktreeId')!
  const service = getRouterParam(event, 'service')!

  return guard(async () => {
    const worktree = await worktrees.find(project, worktreeId)
    if (!worktree) throw new Error('No such worktree.')

    return worktrees.startService(project, worktree.id, worktree.path, service, worktree.branch)
  })
})
