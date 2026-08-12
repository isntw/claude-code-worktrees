import { stop } from '../../../../../lib/supervisor'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const service = getRouterParam(event, 'service')!

  return guard(() => stop(id, service))
})
