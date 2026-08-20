import { readRecipe } from '~~/server/lib/recipe'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  return guard(() => readRecipe(project))
})
