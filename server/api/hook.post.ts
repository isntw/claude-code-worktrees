import type { HookPayload } from '../../shared/types'
import { applyHook } from '../lib/claude'

export default defineEventHandler(async (event) => {
  const payload = await readBody<HookPayload>(event)

  if (!payload?.hook_event_name || !payload.cwd) {
    throw createError({ statusCode: 400, statusMessage: 'hook_event_name and cwd are required' })
  }

  return guard(() => applyHook(payload))
})
