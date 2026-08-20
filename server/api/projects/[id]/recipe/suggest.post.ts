import { serialise } from '~~/server/lib/recipe'
import { suggestRecipe } from '~~/server/lib/detect'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)

  return guard(async () => {
    const recipe = await suggestRecipe(project.rootPath)
    return { recipe, text: serialise(recipe) }
  })
})
