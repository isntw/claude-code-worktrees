import { readConfig } from '~~/server/lib/config'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  return guard(() => readConfig(project))
})
