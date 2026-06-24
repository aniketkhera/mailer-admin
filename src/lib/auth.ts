// Magic-link auth — HS256 compact tokens via node:crypto, config-injected.
//
// The token format + crypto are byte-compatible with the per-site donor
// (lib/auth.ts), so sessions signed by the old code keep validating after
// migration AS LONG AS the same AUTH_SECRET and cookie name are used.
// Pass each site's existing cookie name (es_session / orangish_io_session
// / st_session / …) so live sessions survive.
//
// Hard rule: ZERO top-level process.env reads — everything via cfg.auth.
// Server-only.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import type { MailerConfig } from '../config'

export const MAGIC_LINK_TTL = 15 * 60          // 15 min
export const SESSION_TTL = 30 * 24 * 3600      // 30 days

export class AuthConfigError extends Error {}

export type TokenPayload = { email: string; kind: 'magic' | 'session'; iat: number; exp: number }

export type VerifyResult =
  | { valid: true; payload: TokenPayload }
  | { valid: false; reason: 'malformed' | 'bad-signature' | 'expired' }

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Buffer {
  const pad = 4 - (s.length % 4 || 4)
  const padded = s + '='.repeat(pad === 4 ? 0 : pad)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

export type Auth = ReturnType<typeof createAuth>

export function createAuth(cfg: MailerConfig) {
  const { secret, adminEmails, cookieName } = cfg.auth

  function assertSecret(): string {
    if (!secret || secret.length < 32) {
      throw new AuthConfigError('AUTH_SECRET env var is missing or too short (need ≥32 chars).')
    }
    return secret
  }

  function isAdmin(email: string): boolean {
    const normalized = email.trim().toLowerCase()
    const list = (adminEmails || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    return list.includes(normalized)
  }

  function signToken(payload: Omit<TokenPayload, 'iat' | 'exp'>, ttlSec: number): string {
    const s = assertSecret()
    const now = Math.floor(Date.now() / 1000)
    const full: TokenPayload = { ...payload, iat: now, exp: now + ttlSec }
    const body = b64urlEncode(Buffer.from(JSON.stringify(full)))
    const sig = b64urlEncode(createHmac('sha256', s).update(body).digest())
    return `${body}.${sig}`
  }

  function verifyToken(token: string | null | undefined): VerifyResult {
    if (!token || typeof token !== 'string' || !token.includes('.')) return { valid: false, reason: 'malformed' }
    const s = assertSecret()
    const [body, sig] = token.split('.', 2)
    let expected: Buffer
    try { expected = createHmac('sha256', s).update(body).digest() } catch { return { valid: false, reason: 'malformed' } }
    let actual: Buffer
    try { actual = b64urlDecode(sig) } catch { return { valid: false, reason: 'malformed' } }
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { valid: false, reason: 'bad-signature' }
    let payload: TokenPayload
    try { payload = JSON.parse(b64urlDecode(body).toString('utf8')) } catch { return { valid: false, reason: 'malformed' } }
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return { valid: false, reason: 'expired' }
    return { valid: true, payload }
  }

  function buildSessionCookie(token: string): string {
    return [`${cookieName}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure', `Max-Age=${SESSION_TTL}`].join('; ')
  }
  function buildClearSessionCookie(): string {
    return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`
  }

  // Read + validate the session cookie. Returns the admin email or null.
  async function getAdminSession(): Promise<{ email: string } | null> {
    const store = await cookies()
    const token = store.get(cookieName)?.value
    const v = verifyToken(token)
    if (!v.valid || v.payload.kind !== 'session') return null
    if (!isAdmin(v.payload.email)) return null
    return { email: v.payload.email }
  }

  return {
    cookieName,
    isAdmin,
    signToken,
    verifyToken,
    buildSessionCookie,
    buildClearSessionCookie,
    getAdminSession,
    MAGIC_LINK_TTL,
    SESSION_TTL,
  }
}
