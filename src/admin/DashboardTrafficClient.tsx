'use client'

// Compact traffic summary for the top of the main /admin dashboard. Sits above
// the subscriber ("Audience") stats. Reads the SAME 30-day visits + funnel
// signups the full /admin/visits page loads, and aggregates client-side so the
// 7d/30d toggle re-scopes instantly with no refetch. The deep breakdowns
// (region / device / campaign / hour-of-day / conversion tables) stay on
// /admin/visits — this is the "at a glance" strip, styled to match the existing
// Stat cards. Metric definitions mirror VisitsClient so the numbers agree.

import { useState } from 'react'
import Link from 'next/link'
import type { Theme } from '../config'

export type DashVisit = {
  path: string | null
  visitor_hash: string | null
  utm_source: string | null
  referrer: string | null
  created_at: string
}
export type DashSignup = { subscribed_at: string }

function refHost(r: string | null): string {
  if (!r) return 'Direct'
  try {
    const h = new URL(r).hostname.replace(/^www\./, '')
    return h || 'Direct'
  } catch {
    return r.slice(0, 40)
  }
}
function brandDomain(appUrl: string, brandName: string): string {
  try {
    const h = new URL(appUrl).hostname.replace(/^www\./, '')
    return h || brandName
  } catch {
    return brandName
  }
}

export default function DashboardTrafficClient({
  visits, signups, theme, brandName, appUrl, timezone,
}: {
  visits: DashVisit[]
  signups: DashSignup[]
  theme: Theme
  brandName: string
  appUrl: string
  timezone: string
}) {
  const t = theme
  const [win, setWin] = useState<'7d' | '30d'>('7d')

  const domain = brandDomain(appUrl, brandName)
  const now = Date.now()
  const localDate = (d: string | number) => new Date(d).toLocaleDateString('en-CA', { timeZone: timezone })
  const windowMs = (win === '7d' ? 7 : 30) * 24 * 3600_000
  const inWin = (ts: string) => now - new Date(ts).getTime() <= windowMs

  const wVisits = visits.filter(v => inWin(v.created_at) && !v.path?.startsWith('/admin'))
  const pageViews = wVisits.length
  const wSignups = signups.filter(s => inWin(s.subscribed_at)).length

  // Unique visitors = distinct visitor_hash, gated on >=50% hash coverage (the
  // tracker rollout left older rows unhashed) — mirrors the full traffic page,
  // which shows page views rather than an undercount when coverage is thin.
  const hashed = wVisits.filter(v => v.visitor_hash)
  const uniqueOk = pageViews > 0 && hashed.length / pageViews >= 0.5
  const uniqueVisitors = uniqueOk ? new Set(hashed.map(v => v.visitor_hash as string)).size : null

  // Returning = a stable hash seen on 2+ distinct calendar days in the window.
  const daysByHash = new Map<string, Set<string>>()
  for (const v of hashed) {
    let s = daysByHash.get(v.visitor_hash as string)
    if (!s) { s = new Set<string>(); daysByHash.set(v.visitor_hash as string, s) }
    s.add(localDate(v.created_at))
  }
  let returning = 0
  for (const s of daysByHash.values()) if (s.size >= 2) returning++
  const returningPct = uniqueVisitors && uniqueVisitors > 0 ? Math.round((returning / uniqueVisitors) * 100) : null

  // Signup conversion — per unique visitor when available, else per page view.
  const convDenom = uniqueVisitors ?? pageViews
  const signupRate = convDenom > 0 ? (wSignups / convDenom) * 100 : null
  const perVisitor = uniqueVisitors && uniqueVisitors > 0 ? (pageViews / uniqueVisitors).toFixed(1) : null

  // Top source — utm_source, else referrer host; self-referrals fold into Direct.
  const srcOf = (v: DashVisit): string => {
    if (v.utm_source) return v.utm_source
    const h = refHost(v.referrer)
    return h === domain || h.endsWith('.' + domain) ? 'Direct' : h
  }
  const srcTally = new Map<string, number>()
  for (const v of wVisits) { const k = srcOf(v); srcTally.set(k, (srcTally.get(k) || 0) + 1) }
  const srcSorted = [...srcTally.entries()].sort((a, b) => b[1] - a[1])
  const top1 = srcSorted[0]
  const top2 = srcSorted[1]
  const pct = (n: number) => (pageViews > 0 ? Math.round((n / pageViews) * 100) : 0)

  // Daily sparkline over the window (7 or 30 calendar days, oldest → today).
  const days = win === '7d' ? 7 : 30
  const dateIndex = new Map<string, number>()
  for (let i = 0; i < days; i++) dateIndex.set(localDate(now - (days - 1 - i) * 24 * 3600_000), i)
  const dayCounts = new Array<number>(days).fill(0)
  for (const v of wVisits) { const idx = dateIndex.get(localDate(v.created_at)); if (idx != null) dayCounts[idx]++ }
  const maxDay = Math.max(1, ...dayCounts)

  const label11: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.faintText }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ ...label11, letterSpacing: '0.16em' }}>Traffic</span>
          <div style={{ display: 'inline-flex', border: `1px solid ${t.border}`, borderRadius: 9999, overflow: 'hidden' }}>
            {(['7d', '30d'] as const).map(w => (
              <button
                key={w}
                type="button"
                onClick={() => setWin(w)}
                style={{
                  border: 'none', cursor: 'pointer', padding: '4px 13px', fontSize: 12, fontWeight: 700,
                  background: win === w ? t.accent : 'transparent',
                  color: win === w ? t.accentText : t.mutedText,
                }}
              >
                {w === '7d' ? 'Last 7 days' : 'Last 30 days'}
              </button>
            ))}
          </div>
        </div>
        <Link href="/admin/visits" style={{ fontSize: 13, fontWeight: 700, color: t.accent, textDecoration: 'none' }}>View full traffic →</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
        <Card t={t} label="Visitors" accent
          value={(uniqueVisitors ?? pageViews).toLocaleString()}
          sub={uniqueVisitors != null ? (returningPct != null ? `unique · ${returningPct}% returning` : 'unique') : 'page views'} />
        <Card t={t} label="Page views" value={pageViews.toLocaleString()} sub={perVisitor ? `${perVisitor} per visitor` : undefined} />
        <Card t={t} label="Signup rate" value={signupRate != null ? `${signupRate.toFixed(signupRate < 10 ? 1 : 0)}%` : '—'} sub={`${wSignups.toLocaleString()} from visits`} />
        <Card t={t} label="Top source" small
          value={top1 ? top1[0] : '—'}
          sub={top1 ? `${pct(top1[1])}%${top2 ? ` · then ${top2[0]} ${pct(top2[1])}%` : ''}` : undefined} />
      </div>

      <div style={{ marginTop: 14, padding: '14px 18px', background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={label11}>Visitors per day</span>
          <span style={{ fontSize: 12, color: t.faintText }}>{win === '7d' ? 'last 7 days' : 'last 30 days'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: win === '7d' ? 8 : 3, height: 60 }}>
          {dayCounts.map((c, i) => (
            <div
              key={i}
              title={`${c.toLocaleString()} visit${c === 1 ? '' : 's'}`}
              style={{
                flex: 1, minWidth: 2, borderRadius: '3px 3px 0 0',
                height: `${Math.max(3, Math.round((c / maxDay) * 100))}%`,
                background: i === days - 1 ? t.accent : t.border,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Card({ t, label, value, sub, accent, small }: { t: Theme; label: string; value: string; sub?: string; accent?: boolean; small?: boolean }) {
  return (
    <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.faintText, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: small ? 19 : 28, fontWeight: 800, color: accent ? t.accent : t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: t.mutedText, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}
