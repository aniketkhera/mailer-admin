// Admin dashboard page factory. The consuming site does:
//   import { config } from '@/mailer-admin.config'
//   import { createDashboardPage } from 'mailer-admin/admin/page'
//   export default createDashboardPage(config)
//
// Canonical donor: squashtigers-v2 app/admin/page.tsx. Property-scoped via
// createSupabase(cfg), themed via cfg.theme. The nav/chrome is rendered by
// the shared admin layout (createAdminLayout), so this page renders only
// the <main> content (no AdminNav here — that would double the header).
// Renders a graceful zeroed state when the Mailers env is absent
// (supa.configured() === false), exactly like the donor.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { MailerConfig, Theme } from '../config'
import { createSupabase } from '../lib/supabase'
import { createAuth } from '../lib/auth'
import DashboardTrafficClient, { type DashVisit, type DashSignup } from './DashboardTrafficClient'

export const dynamic = 'force-dynamic'

type SubscriberCounts = {
  total: number
  active: number
  unsubscribed: number
  last7: number
}

type Mailer = {
  id: string
  subject: string
  sent_at: string
  recipient_count: number
}

export function createDashboardPage(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)
  const t = cfg.theme

  async function loadStats(): Promise<{ counts: SubscriberCounts; lastMailer: Mailer | null }> {
    if (!supa.configured()) {
      return { counts: { total: 0, active: 0, unsubscribed: 0, last7: 0 }, lastMailer: null }
    }
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
      // Real counts, not `.length` of a select: a select stops at PostgREST's
      // 1000-row cap, so once squashtigers passed 1,000 (2026-10-26: 1,035 =
      // 918 active + 117 unsubscribed) "Total ever" froze at 1000 and Active,
      // derived as total − unsubscribed, read 883. Active is counted directly
      // rather than derived, so it cannot drift from the Subscribers page.
      const [total, active, unsubscribed, last7, lastMailerRows] = await Promise.all([
        supa.count('subscribers', { property: `eq.${cfg.property}` }),
        supa.count('subscribers', { property: `eq.${cfg.property}`, unsubscribed_at: 'is.null' }),
        supa.count('subscribers', { property: `eq.${cfg.property}`, unsubscribed_at: 'not.is.null' }),
        supa.count('subscribers', { property: `eq.${cfg.property}`, subscribed_at: `gte.${sevenDaysAgo}`, unsubscribed_at: 'is.null' }),
        supa.selectRows<Mailer>('mailers', { select: 'id,subject,sent_at,recipient_count', filters: { property: `eq.${cfg.property}` }, order: 'sent_at.desc', limit: 1 }),
      ])
      return {
        counts: { total, active, unsubscribed, last7 },
        lastMailer: lastMailerRows[0] || null,
      }
    } catch (e) {
      console.error('[mailer-admin /admin] stats load failed:', e instanceof Error ? e.message : e)
      return { counts: { total: 0, active: 0, unsubscribed: 0, last7: 0 }, lastMailer: null }
    }
  }

  // Last-30-day human visits + funnel signups for the top-of-dashboard traffic
  // strip. Same source + shape the full /admin/visits page loads (lighter select
  // — the summary only needs visitor/source/time), so the two always agree. MUST
  // paginate: a plain PostgREST select silently caps at 1000 rows.
  async function loadTraffic(): Promise<{ visits: DashVisit[]; signups: DashSignup[] }> {
    if (!supa.configured()) return { visits: [], signups: [] }
    try {
      const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
      const sources = cfg.signupSources?.length ? cfg.signupSources : ['homepage']
      const [visitsRes, signupsRes] = await Promise.all([
        supa.selectAll<DashVisit>('visits', {
          select: 'path,visitor_hash,utm_source,referrer,created_at',
          filters: { property: `eq.${cfg.property}`, is_bot: 'eq.false', created_at: `gte.${since}` },
          order: 'created_at.desc',
        }),
        supa.selectAll<DashSignup>('subscribers', {
          select: 'subscribed_at',
          filters: { property: `eq.${cfg.property}`, source: `in.(${sources.join(',')})`, subscribed_at: `gte.${since}` },
          order: 'subscribed_at.desc',
        }),
      ])
      return { visits: visitsRes.rows.filter(v => !v.path?.startsWith('/admin')), signups: signupsRes.rows }
    } catch (e) {
      console.error('[mailer-admin /admin] traffic load failed:', e instanceof Error ? e.message : e)
      return { visits: [], signups: [] }
    }
  }

  return async function AdminDashboardPage() {
    const session = await auth.getAdminSession()
    if (!session) redirect('/admin/login')

    const [{ counts, lastMailer }, traffic] = await Promise.all([loadStats(), loadTraffic()])

    return (
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: t.text, margin: '0 0 6px 0' }}>
          Welcome back.
        </h1>
        <p style={{ fontSize: 14, color: t.mutedText, margin: '0 0 28px 0' }}>
          Mailing list, outreach, and traffic for {cfg.brandName}.
        </p>

        <DashboardTrafficClient
          visits={traffic.visits}
          signups={traffic.signups}
          theme={t}
          brandName={cfg.brandName}
          appUrl={cfg.appUrl}
          timezone={cfg.timezone || 'America/New_York'}
        />

        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.faintText, marginBottom: 12 }}>
          Audience
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 28 }}>
          <Stat theme={t} label="Active subscribers" value={counts.active} />
          <Stat theme={t} label="Unsubscribed"       value={counts.unsubscribed} tone="muted" />
          <Stat theme={t} label="Signups (last 7d)"  value={counts.last7} tone="accent" />
          <Stat theme={t} label="Total ever"         value={counts.total} tone="muted" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 14 }}>
          <Tile theme={t} href="/admin/compose" title="Compose new mailer" desc="Send a weekly update or promo to your subscribers." cta="Open composer →" />
          <Tile theme={t} href="/admin/subscribers" title="Manage subscribers" desc="View, add, import, or export your mailing list." cta="Open list →" />
        </div>

        <div style={{ marginTop: 28, padding: '20px 22px', background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.faintText, marginBottom: 10 }}>
            Most recent mailer
          </div>
          {lastMailer ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lastMailer.subject}
                </div>
                <div style={{ fontSize: 13, color: t.mutedText, marginTop: 4 }}>
                  {new Date(lastMailer.sent_at).toLocaleString()} · {lastMailer.recipient_count} recipients
                </div>
              </div>
              <Link href="/admin/sends" style={{ fontSize: 13, fontWeight: 700, color: t.accent, textDecoration: 'none' }}>View all →</Link>
            </div>
          ) : (
            <div style={{ fontSize: 14, color: t.faintText }}>
              No mailers sent yet. <Link href="/admin/compose" style={{ color: t.accent, fontWeight: 700 }}>Send your first →</Link>
            </div>
          )}
        </div>
      </main>
    )
  }
}

function Stat({ theme, label, value, tone = 'normal' }: { theme: Theme; label: string; value: number; tone?: 'normal' | 'muted' | 'accent' }) {
  const t = theme
  const color = tone === 'accent' ? t.accent : tone === 'muted' ? t.faintText : t.text
  return (
    <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.faintText, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function Tile({ theme, href, title, desc, cta }: { theme: Theme; href: string; title: string; desc: string; cta: string }) {
  const t = theme
  return (
    <Link href={href} style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 14, padding: '20px 22px', textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: t.text, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: t.mutedText, lineHeight: 1.55, marginBottom: 12 }}>{desc}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.accent }}>{cta}</div>
    </Link>
  )
}
