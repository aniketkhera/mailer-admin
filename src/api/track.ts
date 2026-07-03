// PUBLIC analytics beacon as a factory configured per site.
//   POST /api/track  { path?, referrer?, utm_source?, utm_medium?, utm_campaign? }
//
// Fired once per page load by a small client beacon. Logs one row per
// visit to the `visits` table (property-scoped) with geo (Vercel edge
// headers) + device/bot detection so we can see per-visitor origin
// (region/country/referrer) for ALL visitors, not just signups.
//
// Fully best-effort + fire-and-forget: ALWAYS returns 204 quickly, never
// blocks the page, never surfaces errors to the client. Admin paths are
// skipped (only public-site visits are interesting).
//
// Canonical donor: squashtigers-v2 / extonsports-v1 app/api/track.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { NOTRACK_COOKIE } from '../config'
import { createSupabase } from '../lib/supabase'
import { rateLimit, clientIp } from '../lib/rate-limit'

// Lightweight bot detection from the user-agent. Not exhaustive — just
// catches the obvious crawlers/monitors so they can be filtered out of
// human-traffic reports. Anything flagged is still stored (is_bot=true).
const BOT_RE = /bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|axios|node-fetch|vercel-screenshot|gptbot|claudebot|ahrefs|semrush/i

function deviceFromUa(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet'
  if (/mobi|iphone|android.*mobile|phone/i.test(ua)) return 'mobile'
  return 'desktop'
}

export function createTrackRoute(cfg: MailerConfig) {
  const supa = createSupabase(cfg)

  async function POST(req: NextRequest) {
    // Always succeed from the client's perspective.
    try {
      // Owner opt-out: a browser carrying the notrack cookie (set on admin
      // login or via the Traffic toggle) is never logged — keeps the
      // operator's own visits out of the public-traffic stats.
      if (req.cookies.get(NOTRACK_COOKIE)?.value === '1') return new NextResponse(null, { status: 204 })
      if (!supa.configured()) return new NextResponse(null, { status: 204 })
      // Generous per-IP cap: a normal visitor never hits it, but it stops a
      // script spraying visit rows. Over-limit is silently dropped (still 204)
      // so the beacon never reveals the throttle.
      if (!rateLimit(`track:${clientIp(req)}`, 120, 60_000)) return new NextResponse(null, { status: 204 })

      let body: Record<string, string | null> = {}
      try { body = (await req.json()) as Record<string, string | null> } catch { /* empty beacon is fine */ }

      // Don't log admin traffic — only public-site visits are interesting.
      const path = clean(body.path)
      if (path && path.startsWith('/admin')) return new NextResponse(null, { status: 204 })

      const ua = req.headers.get('user-agent') || ''
      const is_bot = BOT_RE.test(ua)

      await supa.insertRow('visits', {
        property: cfg.property,
        path,
        referrer: clean(body.referrer),
        utm_source: clean(body.utm_source),
        utm_medium: clean(body.utm_medium),
        utm_campaign: clean(body.utm_campaign),
        country: req.headers.get('x-vercel-ip-country') || null,
        region: hdr(req, 'x-vercel-ip-country-region'),
        city: hdr(req, 'x-vercel-ip-city'),
        device: deviceFromUa(ua),
        is_bot,
      }, 'return=minimal')
    } catch (e) {
      console.error('[mailer-admin track] failed:', e instanceof Error ? e.message : e)
    }
    return new NextResponse(null, { status: 204 })
  }

  return { POST }
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, 500) : null
}
function hdr(req: NextRequest, name: string): string | null {
  const v = req.headers.get(name)
  return v ? decodeURIComponent(v) : null
}
