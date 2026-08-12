import * as worktrees from '~~/server/lib/worktrees'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const worktreeId = getRouterParam(event, 'worktreeId')!

  return guard(async () => {
    const worktree = await worktrees.find(project, worktreeId)
    if (!worktree) throw new Error('No such worktree.')

    return worktrees.startAll(project, worktree.id, worktree.path, worktree.branch)
  })
})
