import { checkRecipe } from '~~/server/lib/recipe'

export default defineEventHandler(async (event) => {
  await requireProject(event)
  const body = await readBody<{ text?: string }>(event)

  if (typeof body?.text !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'text is required' })
  }

  return guard(() => checkRecipe(body.text!))
})
