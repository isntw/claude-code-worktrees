import * as forge from '~~/server/lib/forge'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const forced = getQuery(event).force === '1'
  return guard(() => forge.pulls(project.id, project.rootPath, forced))
})
