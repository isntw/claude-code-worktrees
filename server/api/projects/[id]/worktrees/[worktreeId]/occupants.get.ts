import { occupants } from '~~/server/lib/occupants'
import * as worktrees from '~~/server/lib/worktrees'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const worktreeId = getRouterParam(event, 'worktreeId')!

  return guard(async () => {
    const worktree = await worktrees.find(project, worktreeId)
    if (!worktree) throw new Error('No such worktree.')

    const taken = await worktrees.whatRemovalTakes(project, worktreeId, worktree.path)

    return occupants(worktree.path, taken)
  })
})
