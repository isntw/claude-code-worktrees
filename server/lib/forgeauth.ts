import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeviceCode, DeviceOutcome, ForgeSession } from '../../shared/types'
import { stateDir } from './store'

const CLIENT_ID = process.env.CCWT_GITHUB_CLIENT_ID || 'Ov23liRxgqL7pFa2Wo7L'
const SCOPE = 'repo'

const DEVICE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const API = 'https://api.github.com'

const CALL_MS = 10_000
const SKEW_MS = 300_000

interface Saved {
  token: string
  login: string | null
  scopes: string[]
  savedAt: string
  refreshToken: string | null
  expiresAt: string | null
}

interface Pending {
  deviceCode: string
  interval: number
  expiresAt: number
}

export interface Credential {
  token: string
  login: string | null
}

const pending = new Map<string, Pending>()

let memo: Credential | null = null
let memoAt = 0
let renewing: Promise<Credential | null> | null = null
let epoch = 0

function savedPath(): string {
  return join(stateDir(), 'forge.json')
}

export function configured(): boolean {
  return CLIENT_ID !== ''
}

async function readSaved(): Promise<Saved | null> {
  const raw = await readFile(savedPath(), 'utf8').catch(() => null)
  if (raw === null) return null

  try {
    const parsed = JSON.parse(raw) as Partial<Saved>
    if (typeof parsed.token !== 'string' || !parsed.token) return null
    return {
      token: parsed.token,
      login: typeof parsed.login === 'string' ? parsed.login : null,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.filter((s) => typeof s === 'string') : [],
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
    }
  } catch {
    return null
  }
}

async function writeSaved(saved: Saved): Promise<void> {
  await mkdir(stateDir(), { recursive: true, mode: 0o700 })
  await writeFile(savedPath(), `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 })
}

function expiryOf(seconds: number | undefined): string | null {
  return typeof seconds === 'number' && seconds > 0
    ? new Date(Date.now() + seconds * 1000).toISOString()
    : null
}

async function renew(saved: Saved): Promise<Credential | null> {
  if (!saved.refreshToken) return null

  const era = epoch

  const answered = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: saved.refreshToken,
    }),
    signal: AbortSignal.timeout(CALL_MS),
  }).catch(() => null)

  const raw = (await answered?.json().catch(() => null)) as RawToken | null

  if (!raw || era !== epoch) return null

  if (!raw.access_token) {
    await rm(savedPath(), { force: true })
    return null
  }

  const next: Saved = {
    token: raw.access_token,
    login: saved.login,
    scopes: saved.scopes,
    savedAt: new Date().toISOString(),
    refreshToken: raw.refresh_token ?? saved.refreshToken,
    expiresAt: expiryOf(raw.expires_in),
  }

  await writeSaved(next)
  return { token: next.token, login: next.login }
}

function spent(saved: Saved): boolean {
  if (!saved.expiresAt) return false

  const at = Date.parse(saved.expiresAt)
  return Number.isFinite(at) && at - Date.now() < SKEW_MS
}

export async function credential(): Promise<Credential | null> {
  if (memo && Date.now() - memoAt < 30_000) return memo

  const saved = await readSaved()

  if (saved && spent(saved)) {
    renewing ??= renew(saved).finally(() => {
      renewing = null
    })

    const fresh = await renewing
    memo = fresh
    memoAt = Date.now()
    return fresh
  }

  const found: Credential | null = saved ? { token: saved.token, login: saved.login } : null

  memo = found
  memoAt = Date.now()
  return found
}

function forget(): void {
  memo = null
  memoAt = 0
  renewing = null
  epoch += 1
}

interface Identity {
  login: string | null
  scopes: string[]
}

async function identify(token: string): Promise<Identity | null> {
  const answered = await fetch(`${API}/user`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(CALL_MS),
  }).catch(() => null)

  if (!answered || !answered.ok) return null

  const granted = answered.headers.get('x-oauth-scopes')
  const body = (await answered.json().catch(() => null)) as { login?: string } | null

  return {
    login: typeof body?.login === 'string' ? body.login : null,
    scopes: granted
      ? granted
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [],
  }
}

function permits(scopes: string[]): boolean {
  if (!scopes.length) return true
  return scopes.includes('repo') || scopes.includes('public_repo')
}

export async function session(): Promise<ForgeSession> {
  const held = await credential()
  const ready = configured()

  if (!held) return { login: null, scopes: [], canMerge: false, configured: ready }

  const who = await identify(held.token)
  if (!who) return { login: null, scopes: [], canMerge: false, configured: ready }

  return {
    login: who.login,
    scopes: who.scopes,
    canMerge: permits(who.scopes),
    configured: ready,
  }
}

export async function signOut(): Promise<void> {
  await rm(savedPath(), { force: true })
  forget()
}

interface RawDevice {
  device_code?: string
  user_code?: string
  verification_uri?: string
  expires_in?: number
  interval?: number
  error?: string
  error_description?: string
}

export async function start(): Promise<DeviceCode> {
  if (!configured()) {
    throw new Error(
      'No GitHub client id is set. Register an OAuth app with device flow enabled and start ccwt with CCWT_GITHUB_CLIENT_ID set to its client id.',
    )
  }

  const answered = await fetch(DEVICE_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
    signal: AbortSignal.timeout(CALL_MS),
  }).catch((cause: Error) => {
    throw new Error(`GitHub could not be reached: ${cause.message}`)
  })

  const raw = (await answered.json().catch(() => null)) as RawDevice | null
  if (!raw || !raw.device_code || !raw.user_code || !raw.verification_uri) {
    throw new Error(raw?.error_description || raw?.error || 'GitHub did not return a device code.')
  }

  const handle = randomUUID()
  const seconds = raw.expires_in ?? 900
  const interval = raw.interval ?? 5

  pending.set(handle, {
    deviceCode: raw.device_code,
    interval,
    expiresAt: Date.now() + seconds * 1000,
  })

  return {
    handle,
    userCode: raw.user_code,
    verificationUri: raw.verification_uri,
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    interval,
  }
}

interface RawToken {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

const SAID: Record<string, string> = {
  expired_token: 'The code expired before it was entered. Start again.',
  access_denied: 'The request was refused on GitHub.',
  incorrect_client_credentials: 'That client id was rejected by GitHub.',
  unsupported_grant_type: 'This OAuth app does not have device flow enabled.',
}

export async function poll(handle: string): Promise<DeviceOutcome> {
  const waiting = pending.get(handle)
  if (!waiting) return { state: 'failed', message: 'That sign-in is no longer waiting.' }

  if (Date.now() > waiting.expiresAt) {
    pending.delete(handle)
    return { state: 'failed', message: 'The code expired before it was entered. Start again.' }
  }

  const answered = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      device_code: waiting.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
    signal: AbortSignal.timeout(CALL_MS),
  }).catch(() => null)

  const raw = (await answered?.json().catch(() => null)) as RawToken | null
  if (!raw) return { state: 'pending', interval: waiting.interval }

  if (raw.error === 'authorization_pending') return { state: 'pending', interval: waiting.interval }

  if (raw.error === 'slow_down') {
    waiting.interval += 5
    return { state: 'pending', interval: waiting.interval }
  }

  if (raw.error || !raw.access_token) {
    pending.delete(handle)
    const said = raw.error ? SAID[raw.error] : undefined
    return { state: 'failed', message: said ?? raw.error_description ?? 'GitHub refused the code.' }
  }

  pending.delete(handle)

  const who = await identify(raw.access_token)
  const scopes = raw.scope
    ? raw.scope
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : (who?.scopes ?? [])

  await writeSaved({
    token: raw.access_token,
    login: who?.login ?? null,
    scopes,
    savedAt: new Date().toISOString(),
    refreshToken: raw.refresh_token ?? null,
    expiresAt: expiryOf(raw.expires_in),
  })
  forget()

  return {
    state: 'done',
    session: {
      login: who?.login ?? null,
      scopes,
      canMerge: permits(scopes),
      configured: true,
    },
  }
}
