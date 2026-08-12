import { serialise } from '~~/server/lib/config'
import { suggestConfig } from '~~/server/lib/detect'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)

  return guard(async () => {
    const config = await suggestConfig(project.rootPath)
    return { config, text: serialise(config) }
  })
})
