// GET (list) + POST (manual add) for the subscribers admin, as a factory
// configured per site. Canonical donor: squashtigers-v2.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createSupabase } from '../lib/supabase'
import { createAuth } from '../lib/auth'
import { segmentTag } from '../lib/segments'

export const SUBSCRIBERS_SELECT =
  'id,email,first_name,last_name,phone,city,country,source,tags,subscribed_at,unsubscribed_at,import_metadata'

// Newest first, with `id` breaking ties. Every full-list read goes through
// selectAll, which pages by offset, and offset paging can skip or repeat a
// row unless the order is TOTAL: an import stamps each undated CSV row with
// the time of the import, so hundreds of rows can share one subscribed_at.
// Shared by the Subscribers page, this GET and the composer.
export const SUBSCRIBERS_ORDER = 'subscribed_at.desc,id.desc'

export function createSubscribersRoute(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)

  async function GET() {
    const session = await auth.getAdminSession()
    if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
    try {
      // MUST paginate. This is what the Subscribers page re-reads after every
      // add / import / unsubscribe, and it used to ask for `limit: 1000` — on
      // 2026-10-26 the squashtigers list reached 1,035 and the 35 oldest rows
      // dropped out of the list and its All / Active / Unsubscribed counts.
      const { rows, capped } = await supa.selectAll('subscribers', {
        select: SUBSCRIBERS_SELECT,
        filters: { property: `eq.${cfg.property}` },
        order: SUBSCRIBERS_ORDER,
      })
      if (capped) console.warn('[mailer-admin subscribers GET] hit the 100k pagination cap — list is truncated.')
      return NextResponse.json({ rows })
    } catch (e) {
      console.error('[mailer-admin subscribers GET]', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Could not load subscribers.' }, { status: 500 })
    }
  }

  async function POST(req: NextRequest) {
    const session = await auth.getAdminSession()
    if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

    let body: { email?: string; first_name?: string; last_name?: string; source?: string; segment?: string; tags?: string[] }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const email = (body.email || '').trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email required.' }, { status: 400 })
    }
    const first_name = body.first_name?.trim() || null
    const last_name  = body.last_name?.trim()  || null
    const source     = body.source?.trim()     || 'manual'
    // Accept either an explicit tags[] or a single segment value.
    const segTag = body.segment ? segmentTag(cfg.segments || [], body.segment) : null
    const tags = Array.isArray(body.tags)
      ? body.tags.filter(t => typeof t === 'string').slice(0, 20)
      : (segTag ? [segTag] : [])

    try {
      const existing = await supa.selectOne<{ id: string }>('subscribers', {
        select: 'id',
        filters: { property: `eq.${cfg.property}`, email: `eq.${email}` },
      })
      if (existing) return NextResponse.json({ error: 'That email is already on the list.' }, { status: 409 })
      await supa.insertRow('subscribers', { property: cfg.property, email, first_name, last_name, source, tags }, 'return=minimal')
      return NextResponse.json({ success: true })
    } catch (e) {
      console.error('[mailer-admin subscribers POST]', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Could not add subscriber.' }, { status: 500 })
    }
  }

  return { GET, POST }
}
