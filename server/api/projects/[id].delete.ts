import * as forge from '~~/server/lib/forge'
import * as projects from '~~/server/lib/projects'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)

  await projects.forget(project.id)
  forge.forget(project.id)

  setResponseStatus(event, 204)
  return null
})
