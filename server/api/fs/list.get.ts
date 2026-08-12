import { listDirectory } from '~~/server/lib/browse'

export default defineEventHandler(async (event) => {
  assertBrowsable()

  const path = getQuery(event).path
  return guard(() => listDirectory(typeof path === 'string' ? path : undefined))
})
