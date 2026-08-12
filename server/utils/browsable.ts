const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', ''])

export function boundHost(): string {
  return process.env.NITRO_HOST ?? process.env.HOST ?? ''
}

export function assertBrowsable(): void {
  if (LOOPBACK.has(boundHost())) return

  throw createError({
    statusCode: 403,
    statusMessage: 'Browsing is disabled',
    message: `ccwt is bound to ${boundHost()}. Directory browsing is offered only on loopback.`,
  })
}
