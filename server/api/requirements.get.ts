import * as requirements from '~~/server/lib/requirements'

export default defineEventHandler(async () => {
  return guard(() => requirements.check())
})
