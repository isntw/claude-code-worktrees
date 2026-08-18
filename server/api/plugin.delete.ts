import * as plugin from '~~/server/lib/plugin'

export default defineEventHandler(async () => {
  return guard(() => plugin.remove())
})
