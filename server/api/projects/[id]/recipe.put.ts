import { RecipeInvalid, writeRecipe } from '~~/server/lib/recipe'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const body = await readBody<{ text?: string }>(event)

  if (typeof body?.text !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'text is required' })
  }

  try {
    return await writeRecipe(project, body.text)
  } catch (cause) {
    if (cause instanceof RecipeInvalid) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Invalid recipe',
        message: cause.message,
        data: { issues: cause.issues },
      })
    }
    throw cause
  }
})
