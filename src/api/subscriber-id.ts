// PATCH /api/admin/subscribers/[id] as a factory:
//   { action: 'unsubscribe' | 'resubscribe' }  — soft-flip unsubscribed_at
//   { email?, first_name?, last_name? }         — inline edit from the table
// Canonical donor: squashtigers-v2.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createSupabase } from '../lib/supabase'
import { createAuth } from '../lib/auth'

export function createSubscriberRoute(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)

  async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const session = await auth.getAdminSession()
    if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

    const { id } = await ctx.params
    // Validate the id is a UUID before any DB call — a malformed id can never
    // match a real row, and this keeps attacker-controlled input off the query.
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid subscriber id.' }, { status: 400 })
    }
    let body: { action?: string; email?: string; first_name?: string; last_name?: string }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // ── subscribe-state flip ──
    if (body.action === 'unsubscribe' || body.action === 'resubscribe') {
      const patch = body.action === 'unsubscribe'
        ? { unsubscribed_at: new Date().toISOString() }
        : { unsubscribed_at: null }
      try {
        // property-scoped: a foreign-property id becomes a zero-row no-op
        // instead of a cross-tenant write (the service-role key bypasses RLS).
        await supa.updateRows('subscribers', { id: `eq.${id}`, property: `eq.${cfg.property}` }, patch)
        return NextResponse.json({ success: true })
      } catch (e) {
        console.error('[mailer-admin subscriber PATCH action]', e instanceof Error ? e.message : e)
        return NextResponse.json({ error: 'Update failed.' }, { status: 500 })
      }
    }

    // ── inline field edit ──
    const wantsEdit = 'email' in body || 'first_name' in body || 'last_name' in body
    if (!wantsEdit) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })

    const patch: Record<string, unknown> = {}
    if ('first_name' in body) patch.first_name = (body.first_name ?? '').toString().trim() || null
    if ('last_name'  in body) patch.last_name  = (body.last_name  ?? '').toString().trim() || null

    if ('email' in body) {
      const email = (body.email ?? '').toString().trim().toLowerCase()
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Valid email required.' }, { status: 400 })
      }
      try {
        const dupe = await supa.selectOne<{ id: string }>('subscribers', {
          select: 'id',
          filters: { property: `eq.${cfg.property}`, email: `eq.${email}`, id: `neq.${id}` },
        })
        if (dupe) return NextResponse.json({ error: 'That email is already on the list.' }, { status: 409 })
      } catch (e) {
        console.error('[mailer-admin subscriber PATCH dupe-check]', e instanceof Error ? e.message : e)
        return NextResponse.json({ error: 'Update failed.' }, { status: 500 })
      }
      patch.email = email
    }

    try {
      await supa.updateRows('subscribers', { id: `eq.${id}`, property: `eq.${cfg.property}` }, patch)
      return NextResponse.json({ success: true })
    } catch (e) {
      console.error('[mailer-admin subscriber PATCH edit]', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Update failed.' }, { status: 500 })
    }
  }

  return { PATCH }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
