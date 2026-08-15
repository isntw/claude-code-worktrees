import { statusReport } from '~~/server/lib/git'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  return guard(() => statusReport(project.rootPath))
})
