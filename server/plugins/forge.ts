import * as forge from '../lib/forge'
import { broadcast } from '../routes/_ws'

export default defineNitroPlugin(() => {
  forge.subscribe((projectId, status) => {
    broadcast({ type: 'pulls', projectId, status })
  })
})
