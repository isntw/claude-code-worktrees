export const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export type Verdict = 'allow' | 'bad-host' | 'cross-site' | 'cross-origin' | 'unauthorized'

export interface Attempt {
  path: string
  method: string
  host?: string | undefined
  site?: string | undefined
  origin?: string | undefined
  offered?: string | undefined
}

export function hostname(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1)
  const colon = host.indexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function decide(attempt: Attempt, token: string): Verdict {
  const { host } = attempt

  if (!host || !ALLOWED_HOSTS.has(hostname(host))) return 'bad-host'
  if (!attempt.path.startsWith('/api/')) return 'allow'

  if (token && attempt.offered === token) return 'allow'

  const { site } = attempt
  if (site === 'same-origin') return 'allow'
  if (site === 'none' && SAFE_METHODS.has(attempt.method)) return 'allow'
  if (site) return 'cross-site'

  if (attempt.origin) return sameHost(attempt.origin, host) ? 'allow' : 'cross-origin'

  return token ? 'unauthorized' : 'allow'
}
