import * as worktrees from '~~/server/lib/worktrees'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const body = await readBody<{ name?: string; branch?: string; start?: boolean }>(event)

  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }

  return guard(() =>
    worktrees.create(project, {
      name: body.name!,
      branch: body.branch ?? '',
      start: body.start === true,
    }),
  )
})
