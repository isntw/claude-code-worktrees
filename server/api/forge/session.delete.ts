import * as forge from '~~/server/lib/forge'
import * as forgeauth from '~~/server/lib/forgeauth'

export default defineEventHandler(async () => {
  return guard(async () => {
    await forgeauth.signOut()
    forge.forgetAll()
    return forgeauth.session()
  })
})
