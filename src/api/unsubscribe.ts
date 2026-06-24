// POST /api/unsubscribe?token=...  as a factory — the RFC-8058
// List-Unsubscribe-Post one-click target. lib/email.ts's
// unsubscribePostUrl() points the List-Unsubscribe header here, and mail
// clients (Gmail/Apple Mail) POST it on "Unsubscribe".
//
// The token is the bearer credential — high-entropy UUID, unique-indexed —
// so the flip is NOT property-scoped. We accept the token in the query
// string (the URL the header carries) OR the form/JSON body, since clients
// vary. Always return 200 on a valid token (idempotent flip); a missing /
// unknown token returns 400 / 404. CAN-SPAM: we never block, never auth.
//
// No per-site donor existed (sites previously relied only on the GET
// landing); built fresh to the package contract.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createSupabase } from '../lib/supabase'

async function extractToken(req: NextRequest): Promise<string | null> {
  // 1) query string — the header URL carries ?token=...
  const qp = req.nextUrl.searchParams.get('token')
  if (qp && qp.trim()) return qp.trim()

  // 2) request body — some clients POST the form body instead.
  const ct = (req.headers.get('content-type') || '').toLowerCase()
  try {
    if (ct.includes('application/json')) {
      const j = await req.json().catch(() => null) as { token?: string } | null
      const t = j?.token
      if (typeof t === 'string' && t.trim()) return t.trim()
    } else if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const fd = await req.formData().catch(() => null)
      const t = fd?.get('token')
      if (typeof t === 'string' && t.trim()) return t.trim()
    } else {
      // No / unknown content-type: try a urlencoded text body as a last resort.
      const text = await req.text().catch(() => '')
      if (text) {
        const t = new URLSearchParams(text).get('token')
        if (t && t.trim()) return t.trim()
      }
    }
  } catch {
    // fall through — body parsing failed, token stays whatever the query gave.
  }
  return null
}

export function createUnsubscribeRoute(cfg: MailerConfig) {
  const supa = createSupabase(cfg)

  async function POST(req: NextRequest) {
    const token = await extractToken(req)
    if (!token || token.length < 8) {
      return NextResponse.json({ error: 'Token required.' }, { status: 400 })
    }

    try {
      // NOT property-scoped — the token is a global bearer credential.
      const sub = await supa.selectOne<{ id: string; unsubscribed_at: string | null }>('subscribers', {
        select: 'id,unsubscribed_at',
        filters: { unsubscribe_token: `eq.${token}` },
      })
      if (!sub) return NextResponse.json({ error: 'Unknown token.' }, { status: 404 })

      // Idempotent — only stamp the timestamp on the first flip.
      if (!sub.unsubscribed_at) {
        await supa.updateRows('subscribers', { id: `eq.${sub.id}` }, { unsubscribed_at: new Date().toISOString() })
      }
      return NextResponse.json({ success: true })
    } catch (e) {
      console.error('[mailer-admin /api/unsubscribe] failed:', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Unsubscribe failed.' }, { status: 500 })
    }
  }

  return { POST }
}
