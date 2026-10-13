import * as plugin from '~~/server/lib/plugin'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ action?: string }>(event).catch(() => null)
  const action = body?.action

  return guard(() => {
    if (action === 'enable') return plugin.modToggle(true)
    if (action === 'disable') return plugin.modToggle(false)
    if (action === 'update') return plugin.modUpdate()
    return plugin.modInstall()
  })
})
