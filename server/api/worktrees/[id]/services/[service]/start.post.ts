import { start } from '../../../../../lib/supervisor'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const service = getRouterParam(event, 'service')!

  return guard(() =>
    start(id, id, { name: service, cwd: '.', command: '', portRange: [5200, 5299] }, 0),
  )
})
