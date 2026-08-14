import * as overview from '~~/server/lib/overview'

export default defineEventHandler(async () => {
  return guard(() => overview.build())
})
