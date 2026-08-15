import * as forge from '~~/server/lib/forge'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  return guard(() => forge.pulls(project.id, project.rootPath))
})
