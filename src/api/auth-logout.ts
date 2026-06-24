// POST /api/auth/logout  — as a factory. Clears the cfg.auth.cookieName
// session cookie and redirects to /admin/login. Canonical donor:
// squashtigers-v2 (app/api/auth/logout/route.ts).

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createAuth } from '../lib/auth'

export function createLogoutRoute(cfg: MailerConfig) {
  const auth = createAuth(cfg)

  async function POST(req: NextRequest) {
    const res = NextResponse.redirect(new URL('/admin/login', req.url), 303)
    res.headers.set('Set-Cookie', auth.buildClearSessionCookie())
    return res
  }

  return { POST }
}
