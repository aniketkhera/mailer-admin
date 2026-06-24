// GET (load) + POST (upsert) for the welcome-email settings admin, as a
// factory configured per site. Stores one row per property in
// welcome_emails; validates a non-empty subject + body before allowing
// `enabled` (so we never auto-send blank mail). Canonical donor:
// squashtigers-v2's app/api/admin/welcome/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createSupabase } from '../lib/supabase'
import { createAuth } from '../lib/auth'

export const WELCOME_SELECT = 'property,subject,body_md,enabled,updated_at'

export type WelcomeRow = {
  property: string
  subject: string
  body_md: string
  enabled: boolean
  updated_at: string
}

export function createWelcomeRoute(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)

  // GET — load this property's welcome-email settings
  async function GET() {
    const session = await auth.getAdminSession()
    if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
    if (!supa.configured()) return NextResponse.json({ welcome: null })
    try {
      const row = await supa.selectOne<WelcomeRow>('welcome_emails', {
        select: WELCOME_SELECT,
        filters: { property: `eq.${cfg.property}` },
      })
      return NextResponse.json({ welcome: row })
    } catch (e) {
      console.error('[mailer-admin welcome GET]', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Load failed' }, { status: 500 })
    }
  }

  // POST — save (upsert) the welcome-email settings
  async function POST(req: NextRequest) {
    const session = await auth.getAdminSession()
    if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

    let body: { subject?: string; body_md?: string; enabled?: boolean }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const subject = (body.subject || '').trim()
    const body_md = typeof body.body_md === 'string' ? body.body_md : ''
    const enabled = !!body.enabled

    // Can't enable an empty welcome email — it'd send blank mail.
    if (enabled && (!subject || !body_md.trim())) {
      return NextResponse.json({ error: 'Add a subject and body before enabling.' }, { status: 400 })
    }
    if (!supa.configured()) return NextResponse.json({ error: 'Mailer storage not configured.' }, { status: 503 })

    try {
      const existing = await supa.selectOne<{ property: string }>('welcome_emails', {
        select: 'property',
        filters: { property: `eq.${cfg.property}` },
      })
      if (existing) {
        await supa.updateRows('welcome_emails', { property: `eq.${cfg.property}` }, {
          subject, body_md, enabled, updated_at: new Date().toISOString(),
        })
      } else {
        await supa.insertRow('welcome_emails', { property: cfg.property, subject, body_md, enabled }, 'return=minimal')
      }
      return NextResponse.json({ success: true })
    } catch (e) {
      console.error('[mailer-admin welcome POST]', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Save failed' }, { status: 500 })
    }
  }

  return { GET, POST }
}
