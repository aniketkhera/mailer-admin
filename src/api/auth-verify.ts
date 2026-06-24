// GET /api/auth/verify?token=<magic-link-token>  — as a factory.
//
// Validates the magic-link token, re-checks the allowlist (it may have
// rotated after the link was sent), mints a session token, sets the signed
// httpOnly session cookie named cfg.auth.cookieName, and redirects to
// /admin. On failure it redirects to /admin/login?error=<reason>.
// Canonical donor: squashtigers-v2 (app/api/auth/verify/route.ts).

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { NOTRACK_COOKIE } from '../config'
import { createAuth } from '../lib/auth'

export function createVerifyRoute(cfg: MailerConfig) {
  const auth = createAuth(cfg)

  async function GET(req: NextRequest) {
    const token = req.nextUrl.searchParams.get('token')
    const v = auth.verifyToken(token)

    if (!v.valid || v.payload.kind !== 'magic') {
      const reason = v.valid ? 'invalid' : v.reason
      return NextResponse.redirect(new URL(`/admin/login?error=${reason}`, req.url), 303)
    }

    // Belt + suspenders: the magic link encodes the email, but re-check
    // the allowlist in case it was rotated after the link was sent.
    if (!auth.isAdmin(v.payload.email)) {
      return NextResponse.redirect(new URL('/admin/login?error=not-allowed', req.url), 303)
    }

    const sessionToken = auth.signToken({ email: v.payload.email, kind: 'session' }, auth.SESSION_TTL)
    const res = NextResponse.redirect(new URL('/admin', req.url), 303)
    res.headers.append('Set-Cookie', auth.buildSessionCookie(sessionToken))
    // Exclude the operator's own browser from public-site analytics on login.
    // Not httpOnly so the Traffic-page toggle can read/clear it. 2-year, Lax.
    res.headers.append('Set-Cookie', `${NOTRACK_COOKIE}=1; Path=/; Max-Age=63072000; SameSite=Lax; Secure`)
    return res
  }

  return { GET }
}
