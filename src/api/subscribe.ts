// PUBLIC signup endpoint as a factory configured per site.
//   POST /api/subscribe  { email | contact, name?, first_name?, last_name?,
//                          source?, segment?, referrer?, utm_* }
//
// Two best-effort side effects (an exception in either never fails the
// request, and the endpoint always 200s so a missing-env deploy still
// "works" from the visitor's view):
//
//   1. Upsert into `subscribers` (property-scoped) with acquisition
//      context (referrer / UTM) + geo (Vercel edge headers). A previously
//      unsubscribed contact is RESUBSCRIBED (no welcome re-send); a
//      brand-new contact gets the admin-configured welcome email when
//      cfg.welcomeEmails !== false AND the welcome_emails row is enabled.
//
//   2. Notify cfg.notifyEmail (if set) with the signup details.
//
// When cfg.contactMode === 'email-or-phone' the public form's contact
// field may carry a phone number instead of an email: the subscriber is
// still recorded (phone in the `phone` column, no email side effects),
// and the notify still fires so the lead is never lost.
//
// Canonical donor: squashtigers-v2 app/api/subscribe + notify, plus
// extonsports-v1 app/api/waitlist (acquisition/geo + notify).

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createSupabase } from '../lib/supabase'
import { resolveSegmentTags } from '../lib/segments'
import {
  sendOne,
  unsubscribeUrl,
  markdownToEmailHtml,
  renderEmailHtml,
} from '../lib/email'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function createSubscribeRoute(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const allowPhone = cfg.contactMode === 'email-or-phone'

  async function POST(req: NextRequest) {
    let body: Record<string, string | null> = {}
    try { body = (await req.json()) as Record<string, string | null> } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // Honeypot: a bot that fills the hidden field is silently dropped — we
    // still return success so the trap isn't detectable.
    if (cfg.honeypotField) {
      const trap = body[cfg.honeypotField]
      if (typeof trap === 'string' && trap.trim()) {
        return NextResponse.json({ success: true })
      }
    }

    // Contact: a dedicated email field, else the generic `contact` field
    // (which — when contactMode is email-or-phone — may hold a phone).
    const rawContact = str(body.email) || str(body.contact)
    const looksEmail = !!rawContact && rawContact.includes('@')
    const email = looksEmail ? rawContact.toLowerCase() : null
    const phone = !looksEmail && allowPhone ? rawContact : null

    if (email) {
      if (!EMAIL_RE.test(email)) {
        return NextResponse.json({ error: 'Valid email required.' }, { status: 400 })
      }
    } else if (!phone) {
      // No usable contact at all.
      return NextResponse.json(
        { error: allowPhone ? 'Email or phone required.' : 'Valid email required.' },
        { status: 400 },
      )
    }

    // Name: prefer explicit first/last, else split a single `name` field.
    let first_name = str(body.first_name)
    let last_name = str(body.last_name)
    const name = str(body.name)
    if (!first_name && name) {
      const [f, ...rest] = name.split(/\s+/)
      first_name = f || ''
      last_name = last_name || rest.join(' ')
    }

    const source = str(body.source) || 'homepage'

    // Acquisition context — client captures at submit time.
    const referrer = clean(body.referrer)
    const utm_source = clean(body.utm_source)
    const utm_medium = clean(body.utm_medium)
    const utm_campaign = clean(body.utm_campaign)

    // Segment tags: explicit body[segment.key] (e.g. `sport`) or the generic
    // `segment`, else inferred from a segment-named UTM. Accepts BOTH the
    // public form's field and the admin's `segment` field.
    const segTags = resolveSegmentTags(cfg.segments || [], body, { utmSource: utm_source, utmCampaign: utm_campaign })
    // Extra configured form fields captured as tags (e.g. zipCode -> zip:08540).
    const extraTags = (cfg.signupTags || [])
      .map(t => { const v = str(body[t.field]); return v ? `${t.prefix}${v.slice(0, 64)}` : null })
      .filter((x): x is string => !!x)
    const tags = [...segTags, ...extraTags]

    // Geo — Vercel sets these at the edge; null in local dev.
    const country = req.headers.get('x-vercel-ip-country') || null
    const region = hdr(req, 'x-vercel-ip-country-region')
    const city = hdr(req, 'x-vercel-ip-city')

    // ── 1. Persist to subscribers ────────────────────────────────────
    if (supa.configured()) {
      try {
        // Dedupe on whichever contact we have.
        const filters: Record<string, string> = { property: `eq.${cfg.property}` }
        if (email) filters.email = `eq.${email}`
        else if (phone) filters.phone = `eq.${phone}`

        const existing = await supa.selectOne<{ id: string; unsubscribed_at: string | null }>(
          'subscribers',
          { select: 'id,unsubscribed_at', filters },
        )

        if (existing) {
          // Resubscribe (clear the opt-out). No welcome re-send — they were
          // welcomed the first time. Active contacts are left untouched so
          // we don't overwrite their original acquisition data.
          if (existing.unsubscribed_at) {
            await supa.updateRows('subscribers', { id: `eq.${existing.id}` }, { unsubscribed_at: null })
          }
        } else {
          const inserted = await supa.insertRow<{ unsubscribe_token: string | null }>('subscribers', {
            property: cfg.property,
            email,
            phone,
            first_name: first_name || null,
            last_name: last_name || null,
            source,
            tags,
            referrer,
            utm_source,
            utm_medium,
            utm_campaign,
            country,
            region,
            city,
          })
          // Brand-new email subscriber → send the admin-configured welcome
          // email (if enabled). Phone-only contacts get no email.
          if (email) {
            await sendWelcomeIfEnabled(cfg, supa, email, inserted?.unsubscribe_token || null)
          }
        }
      } catch (e) {
        console.error('[mailer-admin subscribe] DB write failed:', e instanceof Error ? e.message : e)
      }
    }

    // ── 2. Notify the property owner ─────────────────────────────────
    if (cfg.notifyEmail) {
      try {
        await sendOne(cfg, {
          to: cfg.notifyEmail,
          subject: `New ${cfg.brandName} signup${name ? ` — ${name}` : email ? ` — ${email}` : ''}`,
          html: notifyHtml(cfg, {
            name, email, phone, source, referrer, utm_source, utm_campaign, city, region, country,
          }),
        })
      } catch (e) {
        console.error('[mailer-admin subscribe] notify email failed:', e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json({ success: true })
  }

  return { POST }
}

// Loads this property's welcome email; if cfg.welcomeEmails !== false AND
// the row is enabled + non-empty, renders it through the shared email
// shell and sends to the new subscriber. Link color = the brand accent.
async function sendWelcomeIfEnabled(
  cfg: MailerConfig,
  supa: ReturnType<typeof createSupabase>,
  email: string,
  token: string | null,
): Promise<void> {
  if (cfg.welcomeEmails === false) return
  try {
    const w = await supa.selectOne<{ subject: string; body_md: string; enabled: boolean }>(
      'welcome_emails',
      { select: 'subject,body_md,enabled', filters: { property: `eq.${cfg.property}` } },
    )
    if (!w || !w.enabled || !w.subject?.trim() || !w.body_md?.trim()) return
    const html = renderEmailHtml(cfg, {
      subject: w.subject,
      bodyHtml: markdownToEmailHtml(w.body_md, { linkColor: cfg.theme.accent }),
      unsubscribeUrl: token ? unsubscribeUrl(cfg, token) : '#',
    })
    await sendOne(cfg, { to: email, subject: w.subject, html })
  } catch (e) {
    console.error('[mailer-admin subscribe] welcome email failed:', e instanceof Error ? e.message : e)
  }
}

// ── owner-notification email body ────────────────────────────────────
function notifyHtml(
  cfg: MailerConfig,
  o: {
    name: string; email: string | null; phone: string | null; source: string
    referrer: string | null; utm_source: string | null; utm_campaign: string | null
    city: string | null; region: string | null; country: string | null
  },
): string {
  const accent = cfg.theme.accent
  const loc = [o.city, o.region, o.country].filter((x): x is string => !!x).map(esc).join(', ')
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;width:140px;">${label}</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${value}</td></tr>`
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="color:${accent};margin:0 0 24px;font-size:18px;">New ${esc(cfg.brandName)} signup</h2>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
        ${o.name ? row('Name', esc(o.name)) : ''}
        ${o.email ? row('Email', `<a href="mailto:${esc(o.email)}" style="color:${accent};">${esc(o.email)}</a>`) : ''}
        ${o.phone ? row('Phone', esc(o.phone)) : ''}
        ${row('Source', esc(o.source))}
        ${o.referrer ? row('Referrer', esc(o.referrer)) : ''}
        ${o.utm_source ? row('UTM source', esc(o.utm_source)) : ''}
        ${o.utm_campaign ? row('UTM campaign', esc(o.utm_campaign)) : ''}
        ${loc ? row('Location', loc) : ''}
        ${row('When', new Date().toISOString())}
      </table>
      <p style="margin-top:24px;color:#888;font-size:12px;">They&rsquo;ve been added to the mailing list automatically.</p>
    </div>`
}

// ── helpers ──────────────────────────────────────────────────────────
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
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
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
