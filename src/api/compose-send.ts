// POST /api/admin/compose/send as a factory.
//   { subject, body_md, recipient_ids: string[], filter_summary?: object }
//
// Validates -> renders Markdown -> re-fetches each recipient's email +
// unsubscribe_token (re-checking unsubscribed_at IS NULL at send time so a
// race where someone unsubs between picker load and send doesn't email
// them) -> sends via Resend in batches -> writes a property-scoped mailers
// audit row (best-effort).
//
// Canonical donor: squashtigers-v2 app/api/admin/compose/send/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createSupabase } from '../lib/supabase'
import { createAuth } from '../lib/auth'
import { markdownToEmailHtml, sendMailer } from '../lib/email'

export const maxDuration = 60

type SendBody = {
  subject?: string
  body_md?: string
  recipient_ids?: string[]
  filter_summary?: Record<string, unknown>
}

type RecipientLoad = {
  id: string
  email: string
  unsubscribe_token: string
}

export function createSendRoute(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)

  async function POST(req: NextRequest) {
    const session = await auth.getAdminSession()
    if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

    let body: SendBody
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const subject = (body.subject || '').trim()
    const body_md = (body.body_md || '').trim()
    // De-duplicated: the lookup below runs in chunks, and an id listed twice
    // could land in two chunks and come back twice — two emails to one person.
    const ids = Array.isArray(body.recipient_ids) ? [...new Set(body.recipient_ids.filter(s => typeof s === 'string'))] : []
    if (!subject)         return NextResponse.json({ error: 'Subject required.' }, { status: 400 })
    if (!body_md)         return NextResponse.json({ error: 'Body required.' }, { status: 400 })
    if (ids.length === 0) return NextResponse.json({ error: 'Pick at least one recipient.' }, { status: 400 })
    if (ids.length > 5000) return NextResponse.json({ error: 'Too many recipients (max 5000).' }, { status: 400 })

    const bodyHtml = markdownToEmailHtml(body_md, { linkColor: cfg.theme.accent })

    // Re-fetch recipients server-side. We filter unsubscribed_at IS NULL
    // again here in case someone unsubbed between picker load and send.
    // Chunked, 200 ids per `in.(...)`, like the import's lookups: this used to
    // be ONE request carrying every id, which put ~39 bytes of URL per
    // recipient on the wire (918 active on squashtigers on 2026-10-26 ≈ 35 KB)
    // and, past 1,000 recipients, would have been cut to 1000 rows by
    // PostgREST's cap — the rest silently not emailed.
    const rows: RecipientLoad[] = []
    try {
      for (const part of chunk(ids, 200)) {
        rows.push(...await supa.selectRows<RecipientLoad>('subscribers', {
          select: 'id,email,unsubscribe_token',
          filters: {
            property: `eq.${cfg.property}`,
            id: `in.(${part.join(',')})`,
            unsubscribed_at: 'is.null',
          },
        }))
      }
    } catch (e) {
      console.error('[mailer-admin compose/send] recipient lookup failed:', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Could not load recipients.' }, { status: 500 })
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No active recipients matched. Some may have unsubscribed.' }, { status: 409 })
    }

    // Send.
    let report
    try {
      report = await sendMailer(cfg, {
        subject,
        bodyHtml,
        recipients: rows.map(r => ({ email: r.email, unsubscribe_token: r.unsubscribe_token })),
      })
    } catch (e) {
      console.error('[mailer-admin compose/send] send pipeline threw:', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Send pipeline failed.' }, { status: 502 })
    }

    // Write audit row. Best-effort; if this fails we still return success
    // (the emails actually went out, which matters more).
    try {
      await supa.insertRow('mailers', {
        property: cfg.property,
        subject,
        body_md,
        body_html: bodyHtml,
        sent_by_email: session.email,
        recipient_count: report.sent,
        recipient_emails: rows.map(r => r.email),
        filter_json: body.filter_summary || {},
        send_errors: report.errors.length > 0 ? report.errors : null,
      }, 'return=minimal')
    } catch (e) {
      console.error('[mailer-admin compose/send] audit insert failed:', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({
      success: true,
      sent: report.sent,
      failed: report.failed,
      errors: report.errors.length > 0 ? report.errors.length : 0,
    })
  }

  return { POST }
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
