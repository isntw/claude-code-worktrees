import * as plugin from '~~/server/lib/plugin'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ action?: string }>(event).catch(() => null)
  const action = body?.action

  return guard(() => {
    if (action === 'enable') return plugin.enable()
    if (action === 'refresh') return plugin.refresh()
    return plugin.install()
  })
})
