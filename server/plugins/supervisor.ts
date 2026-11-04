import * as projects from '../lib/projects'
import * as supervisor from '../lib/supervisor'
import * as worktrees from '../lib/worktrees'
import { broadcast } from '../routes/_ws'

export default defineNitroPlugin((nitro) => {
  supervisor.subscribe((line) => {
    broadcast({ type: 'log', line })
  })

  supervisor.subscribeStatus((worktreeId, status) => {
    broadcast({ type: 'service', worktreeId, status })
  })

  supervisor.subscribeProgress((worktreeId, progress) => {
    broadcast({ type: 'provision', worktreeId, progress })
  })

  const shutdown = () => supervisor.stopAll()

  nitro.hooks.hook('close', shutdown)
  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })

  if (!useRuntimeConfig().token) return

  void projects
    .list()
    .then(worktrees.resume)
    .catch(() => undefined)
})
