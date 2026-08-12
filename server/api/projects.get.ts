import * as projects from '~~/server/lib/projects'

export default defineEventHandler(async () => {
  return guard(() => projects.list())
})
