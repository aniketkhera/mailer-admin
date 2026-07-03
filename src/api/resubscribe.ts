// POST /api/resubscribe  { token }  as a factory.
//
// Flips unsubscribed_at back to NULL for the subscriber matching this token.
// The token is the bearer credential — high-entropy UUID, unique-indexed —
// so the lookup is NOT property-scoped. Idempotent: re-running on an
// already-active row is a no-op.
//
// Canonical donor: squashtigers-v2 app/api/resubscribe/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createSupabase } from '../lib/supabase'
import { rateLimit, clientIp } from '../lib/rate-limit'

export function createResubscribeRoute(cfg: MailerConfig) {
  const supa = createSupabase(cfg)

  async function POST(req: NextRequest) {
    if (!rateLimit(`resubscribe:${clientIp(req)}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
    }
    let body: { token?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const token = body.token
    if (!token || typeof token !== 'string' || token.length < 8) {
      return NextResponse.json({ error: 'Token required.' }, { status: 400 })
    }

    try {
      const sub = await supa.selectOne<{ id: string }>('subscribers', {
        select: 'id',
        filters: { unsubscribe_token: `eq.${token}` },
      })
      if (!sub) return NextResponse.json({ error: 'Unknown token.' }, { status: 404 })
      await supa.updateRows('subscribers', { id: `eq.${sub.id}` }, { unsubscribed_at: null })
      return NextResponse.json({ success: true })
    } catch (e) {
      console.error('[mailer-admin /api/resubscribe] failed:', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Resubscribe failed.' }, { status: 500 })
    }
  }

  return { POST }
}
