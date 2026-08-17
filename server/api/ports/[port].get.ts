import * as holders from '~~/server/lib/holders'

export default defineEventHandler(async (event) => {
  const raw = getRouterParam(event, 'port')!

  return guard(async () => {
    const port = Number.parseInt(raw, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${raw} is not a port number.`)
    }

    return holders.holders(port)
  })
})
