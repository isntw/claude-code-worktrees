import * as plugin from '~~/server/lib/plugin'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ action?: string }>(event).catch(() => null)

  return guard(() => (body?.action === 'enable' ? plugin.enable() : plugin.install()))
})
