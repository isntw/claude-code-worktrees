import { launchSession } from '../../../../lib/claude'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  return guard(() => launchSession(id, 'claude'))
})
