import * as forge from '~~/server/lib/forge'

const METHODS = ['merge', 'squash', 'rebase'] as const

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const number = Number.parseInt(getRouterParam(event, 'number') ?? '', 10)

  if (!Number.isInteger(number) || number <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A pull request number is required' })
  }

  const body = await readBody<{ method?: unknown; sha?: unknown }>(event)
  const method = METHODS.find((entry) => entry === body?.method)
  const sha = typeof body?.sha === 'string' ? body.sha : ''

  if (!method) {
    throw createError({ statusCode: 422, statusMessage: 'merge, squash or rebase is required' })
  }

  if (!sha) {
    throw createError({
      statusCode: 422,
      statusMessage: 'The head commit this card was drawn from is required',
    })
  }

  return guard(async () => {
    const outcome = await forge.merge(project.rootPath, number, method, sha)
    forge.forget(project.id)
    return outcome
  })
})
