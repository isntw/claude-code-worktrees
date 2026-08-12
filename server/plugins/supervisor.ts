import * as supervisor from '../lib/supervisor'
import { broadcast } from '../routes/_ws'

export default defineNitroPlugin((nitro) => {
  supervisor.subscribe((line) => {
    broadcast({ type: 'log', line })
  })

  supervisor.subscribeStatus((worktreeId, status) => {
    broadcast({ type: 'service', worktreeId, status })
  })

  const shutdown = () => {
    void supervisor.stopAll()
  }

  nitro.hooks.hook('close', shutdown)
  process.once('SIGINT', () => {
    shutdown()
    process.exit(0)
  })
  process.once('SIGTERM', () => {
    shutdown()
    process.exit(0)
  })
})
