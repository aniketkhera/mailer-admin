// POST /api/lead as a factory — the public contact / "Schedule a free
// evaluation" form target. Gated by cfg.leads?.enabled: a site that doesn't
// configure leads gets a 404 no-op (the route can be mounted unconditionally
// and stays inert).
//
//   { name, email, phone?, interest?, message?,
//     referrer?, utm_source?, utm_medium?, utm_campaign? }
//
// Persists to cfg.leads.table, property-scoped. If the Mailer Supabase env
// isn't configured (e.g. a preview before env vars are set) the route still
// returns 200 so the UI can be demoed — it logs and skips the insert.
//
// Canonical donor: peac-v1 app/api/lead/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createSupabase } from '../lib/supabase'

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length ? t.slice(0, 2000) : null
}

export function createLeadRoute(cfg: MailerConfig) {
  const supa = createSupabase(cfg)

  async function POST(req: NextRequest) {
    // Leads disabled for this site → the endpoint doesn't exist.
    if (!cfg.leads?.enabled) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    }
    const table = cfg.leads.table

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const name = clean(body.name)
    const email = clean(body.email)
    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email.' }, { status: 400 })
    }

    const country = req.headers.get('x-vercel-ip-country') || null
    const region = req.headers.get('x-vercel-ip-country-region')
      ? decodeURIComponent(req.headers.get('x-vercel-ip-country-region')!)
      : null
    const city = req.headers.get('x-vercel-ip-city')
      ? decodeURIComponent(req.headers.get('x-vercel-ip-city')!)
      : null

    const row = {
      property: cfg.property,
      name,
      email: email.toLowerCase(),
      phone: clean(body.phone),
      interest: clean(body.interest),
      message: clean(body.message),
      referrer: clean(body.referrer),
      utm_source: clean(body.utm_source),
      utm_medium: clean(body.utm_medium),
      utm_campaign: clean(body.utm_campaign),
      country,
      region,
      city,
    }

    if (supa.configured()) {
      try {
        await supa.insertRow(table, row, 'return=minimal')
      } catch (err) {
        console.error('[mailer-admin /api/lead] insert failed:', err instanceof Error ? err.message : err)
        return NextResponse.json({ error: 'Could not save your request. Please try again.' }, { status: 500 })
      }
    } else {
      console.warn('[mailer-admin /api/lead] Supabase not configured — lead not persisted:', row.email)
    }

    return NextResponse.json({ ok: true })
  }

  return { POST }
}
