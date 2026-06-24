// POST /api/auth/magic-link  { email }  — as a factory configured per site.
//
// Always returns success — we never leak which emails are admins. An
// unknown email gets a no-op success; an admin email gets a signed magic
// link emailed to them. The link base is cfg.appUrl. The sign-in email is
// themed via cfg.brandName + cfg.theme.accent. Canonical donor:
// squashtigers-v2 (app/api/auth/magic-link/route.ts).

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createAuth, AuthConfigError } from '../lib/auth'
import { sendOne } from '../lib/email'

export function createMagicLinkRoute(cfg: MailerConfig) {
  const auth = createAuth(cfg)

  async function POST(req: NextRequest) {
    let body: { email?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const email = (body.email || '').trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email required.' }, { status: 400 })
    }

    // Generic success when the email isn't allowlisted. Don't reveal
    // who is or isn't an admin.
    if (!auth.isAdmin(email)) {
      return NextResponse.json({ success: true })
    }

    let token: string
    try {
      token = auth.signToken({ email, kind: 'magic' }, auth.MAGIC_LINK_TTL)
    } catch (e) {
      if (e instanceof AuthConfigError) {
        console.error('[mailer-admin auth/magic-link] config error:', e.message)
        return NextResponse.json({ error: 'Server auth config error.' }, { status: 500 })
      }
      throw e
    }

    const base = signInBaseUrl(cfg, req)
    const link = `${base}/api/auth/verify?token=${encodeURIComponent(token)}`

    try {
      await sendOne(cfg, {
        to: email,
        subject: `Your ${cfg.brandName} admin sign-in link`,
        html: signInEmailHtml(cfg, link),
      })
    } catch (e) {
      console.error('[mailer-admin auth/magic-link] send failed:', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Could not send sign-in email.' }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  }

  return { POST }
}

// On a Vercel PREVIEW (or dev) the sign-in link points back at the SAME
// deployment, so admin login is testable on the preview URL. PRODUCTION
// always uses the fixed canonical cfg.appUrl (no host-header injection on
// the live site). Only the admin sign-in link is affected — real subscriber
// emails (sends / welcome / unsubscribe) always use cfg.appUrl.
function signInBaseUrl(cfg: MailerConfig, req: NextRequest): string {
  const env = process.env.VERCEL_ENV
  if (env && env !== 'production') {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    if (host) return `https://${host.replace(/\/+$/, '')}`
  }
  return cfg.appUrl.replace(/\/$/, '')
}

function signInEmailHtml(cfg: MailerConfig, link: string): string {
  const brand = cfg.brandName
  const bg = cfg.theme.pageBg
  const accent = cfg.theme.accent
  const accentText = cfg.theme.accentText
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${bg};font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="500" cellpadding="0" cellspacing="0" border="0" style="max-width:500px;width:100%;background:#fff;border:1px solid #E8D5C8;border-radius:14px;">
        <tr><td style="padding:32px;">
          <div style="font-size:13px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:${accent};margin-bottom:18px;">${esc(brand)}</div>
          <h1 style="margin:0 0 14px 0;font-size:22px;color:#0D0D0D;">Sign in to the admin</h1>
          <p style="margin:0 0 22px 0;font-size:15px;color:#444;line-height:1.6;">
            Click the button below to sign in. This link is good for 15 minutes.
          </p>
          <p style="margin:0 0 24px 0;">
            <a href="${link}" style="display:inline-block;padding:12px 22px;background:${accent};color:${accentText};text-decoration:none;font-weight:700;border-radius:8px;font-size:15px;">Sign in</a>
          </p>
          <p style="margin:24px 0 0 0;font-size:12px;color:#888;line-height:1.55;">
            If you didn&rsquo;t request this, you can ignore the email — no account changes happen until the link is clicked.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
