import * as forgeauth from '~~/server/lib/forgeauth'

export default defineEventHandler(async () => {
  return guard(() => forgeauth.session())
})
