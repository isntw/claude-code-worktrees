const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

const COOKIE = 'ccwt_session'

function hostname(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1)
  const colon = host.indexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

export default defineEventHandler(async (event) => {
  const host = getRequestHeader(event, 'host')

  if (!host || !ALLOWED_HOSTS.has(hostname(host))) {
    throw createError({ statusCode: 403, statusMessage: 'Host not allowed' })
  }

  const token = useRuntimeConfig(event).token
  if (!token) return

  const url = getRequestURL(event)
  const offered = url.searchParams.get('t')

  if (offered && offered === token) {
    setCookie(event, COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: false,
    })
    url.searchParams.delete('t')
    return sendRedirect(event, `${url.pathname}${url.search}`, 302)
  }

  if (!event.path.startsWith('/api/')) return

  const header = getRequestHeader(event, 'x-ccwt-token')
  if (header === token) return
  if (getCookie(event, COOKIE) === token) return

  throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
})
