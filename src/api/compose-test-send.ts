// POST /api/admin/compose/test-send as a factory.  { subject, body_md }
//
// Renders the mailer and sends it to the signed-in admin's own address via
// sendOne. Uses a dummy unsubscribe token (the admin isn't a real
// subscriber) — clicking it just lands on the public /unsubscribe page with
// an unknown-token message. Shared by the composer AND the welcome editor.
//
// Canonical donor: squashtigers-v2 app/api/admin/compose/test-send/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createAuth } from '../lib/auth'
import { markdownToEmailHtml, renderEmailHtml, sendOne, unsubscribeUrl } from '../lib/email'

export function createTestSendRoute(cfg: MailerConfig) {
  const auth = createAuth(cfg)

  async function POST(req: NextRequest) {
    const session = await auth.getAdminSession()
    if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

    let body: { subject?: string; body_md?: string }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const subject = (body.subject || '').trim()
    const body_md = (body.body_md || '').trim()
    if (!subject) return NextResponse.json({ error: 'Subject required.' }, { status: 400 })
    if (!body_md) return NextResponse.json({ error: 'Body required.' }, { status: 400 })

    const bodyHtml = markdownToEmailHtml(body_md, { linkColor: cfg.theme.accent })
    const html = renderEmailHtml(cfg, {
      subject: `[TEST] ${subject}`,
      bodyHtml,
      unsubscribeUrl: unsubscribeUrl(cfg, 'test-token-not-real'),
    })
    try {
      await sendOne(cfg, { to: session.email, subject: `[TEST] ${subject}`, html })
      return NextResponse.json({ success: true })
    } catch (e) {
      console.error('[mailer-admin compose/test-send]', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Test send failed.' }, { status: 502 })
    }
  }

  return { POST }
}
