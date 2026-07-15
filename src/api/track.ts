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

// Bot detection from the user-agent. Not exhaustive — a scraper spoofing a
// real browser UA still slips through (dedup on visitor_hash + the digest's
// repeat-visitor flood check are the second line of defense). But this catches
// the large majority of declared crawlers/monitors/HTTP-clients so they can be
// filtered out of human-traffic reports. Anything flagged is still stored
// (is_bot=true) so bot volume itself remains reportable.
const BOT_RE = /bot\b|bot\/|[a-z]bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|meta-externalagent|facebot|headless|lighthouse|pagespeed|pingdom|uptime|statuscake|site24x7|checkly|newrelic|datadog|zabbix|monitoring|curl|wget|python-requests|python-urllib|aiohttp|httpx|axios|node-fetch|go-http-client|okhttp|apache-httpclient|java\/|libwww|scrapy|phantomjs|puppeteer|playwright|selenium|vercel-screenshot|gptbot|oai-searchbot|chatgpt|claudebot|claude-web|anthropic|perplexitybot|ccbot|google-extended|googleother|google-inspectiontool|bytespider|petalbot|amazonbot|dataforseo|dotbot|mj12bot|ahrefs|semrush|screaming.?frog|dashlink|embedly|discordbot|slackbot|telegrambot|whatsapp|linkedinbot|twitterbot|pinterest/i

function deviceFromUa(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet'
  if (/mobi|iphone|android.*mobile|phone/i.test(ua)) return 'mobile'
  return 'desktop'
}

// Salted hash of ip+ua — a cookieless, IP-free visitor id. It is STABLE across
// days (no date in the input) so reports can tell NEW from RETURNING visitors
// (a hash seen on more than one day = returning) and still count daily uniques
// (distinct hashes in a day). Trade-off vs the old daily-rotating hash: a person
// is linkable across days by network+browser — but there's still no raw IP and
// no cookie, so the sites stay consent-free. Salt is a per-deploy secret; set
// VISITOR_HASH_SALT to a random string in prod (unset → works but guessable).
const HASH_SALT = process.env.VISITOR_HASH_SALT || 'mailer-admin-visits-v1'
async function visitorHash(property: string, ip: string, ua: string): Promise<string | null> {
  try {
    const input = `${HASH_SALT}|${property}|${ip}|${ua}`
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
  } catch {
    return null // Web Crypto unavailable — degrade to no-hash rather than fail the beacon.
  }
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
      // Privacy-preserving per-visitor id: salted daily hash of ip+ua. Never
      // stores the raw IP. Lets the reports dedup page loads → unique visitors.
      const visitor_hash = await visitorHash(cfg.property, clientIp(req), ua)

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
        user_agent: ua ? ua.slice(0, 400) : null,
        visitor_hash,
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
