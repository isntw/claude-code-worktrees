import { probe } from '~~/server/lib/browse'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ path?: string }>(event)
  return guard(() => probe(body?.path ?? ''))
})
