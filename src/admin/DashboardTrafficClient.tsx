'use client'

// Compact traffic summary for the top of the main /admin dashboard. Sits above
// the subscriber ("Audience") stats. Reads the SAME 30-day visits + funnel
// signups the full /admin/visits page loads, and aggregates client-side so the
// Today / 7d / 30d toggle re-scopes instantly with no refetch. The deep
// breakdowns (region / device / campaign / hour-of-day / conversion tables) stay
// on /admin/visits — this is the "at a glance" strip, styled to match the
// existing Stat cards. Metric definitions mirror VisitsClient so the numbers
// agree: "today" is the calendar day in the site's timezone (not a rolling 24h),
// 7d/30d are rolling.

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

type Win = 'today' | '7d' | '30d'

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

// Readable label for a path: the home page reads "Home"; a query string is
// dropped (it's noise for a top-pages list) and the path is otherwise shown
// as-is (already relative, e.g. "/camps").
function prettyPath(p: string | null): string {
  if (!p || p === '/') return 'Home'
  return p.split('?')[0] || p
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
  const [win, setWin] = useState<Win>('today')

  const domain = brandDomain(appUrl, brandName)
  const now = Date.now()
  const localDate = (d: string | number) => new Date(d).toLocaleDateString('en-CA', { timeZone: timezone })
  const todayLocal = localDate(now)

  // "Today" = calendar day in the site's timezone (resets at local midnight, not
  // a rolling 24h); 7d/30d stay rolling — matches the full traffic page.
  const inWin = (ts: string): boolean =>
    win === 'today' ? localDate(ts) === todayLocal
    : win === '7d' ? now - new Date(ts).getTime() <= 7 * 24 * 3600_000
    : true

  const humanVisits = visits.filter(v => !v.path?.startsWith('/admin'))
  const wVisits = humanVisits.filter(v => inWin(v.created_at))
  const pageViews = wVisits.length
  const wSignups = signups.filter(s => inWin(s.subscribed_at)).length

  // Unique visitors = distinct visitor_hash, gated on >=50% hash coverage (the
  // tracker rollout left older rows unhashed) — mirrors the full traffic page,
  // which shows page views rather than an undercount when coverage is thin.
  const hashed = wVisits.filter(v => v.visitor_hash)
  const uniqueOk = pageViews > 0 && hashed.length / pageViews >= 0.5
  const winHashes = new Set(hashed.map(v => v.visitor_hash as string))
  const uniqueVisitors = uniqueOk ? winHashes.size : null

  // Returning is classified over ALL loaded (~30d) data: a stable hash seen on
  // 2+ distinct calendar days is "returning". Applied to the selected window, so
  // even "today" can say how many of today's visitors have been here before.
  const daysByHashAll = new Map<string, Set<string>>()
  for (const v of humanVisits) {
    if (!v.visitor_hash) continue
    let s = daysByHashAll.get(v.visitor_hash)
    if (!s) { s = new Set<string>(); daysByHashAll.set(v.visitor_hash, s) }
    s.add(localDate(v.created_at))
  }
  let returning = 0
  for (const h of winHashes) if ((daysByHashAll.get(h)?.size ?? 0) >= 2) returning++
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

  // Most visited pages in the window (query strings collapsed via prettyPath).
  const pageTally = new Map<string, number>()
  for (const v of wVisits) { const p = prettyPath(v.path); pageTally.set(p, (pageTally.get(p) || 0) + 1) }
  const topPages = [...pageTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const topPageMax = topPages[0]?.[1] ?? 1

  // Sparkline — today: 24 hourly buckets in the site timezone (current hour
  // highlighted); 7d/30d: one bar per calendar day, oldest → today (today
  // highlighted).
  let buckets: number[]
  let highlightIdx: number
  let sparkLeft: string
  if (win === 'today') {
    const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false, hourCycle: 'h23' })
    const hourOf = (iso: string | number) => parseInt(hourFmt.format(new Date(iso)), 10) % 24
    buckets = new Array(24).fill(0)
    for (const v of wVisits) buckets[hourOf(v.created_at)]++
    highlightIdx = hourOf(now)
    sparkLeft = 'Visitors per hour'
  } else {
    const days = win === '7d' ? 7 : 30
    const dateIndex = new Map<string, number>()
    for (let i = 0; i < days; i++) dateIndex.set(localDate(now - (days - 1 - i) * 24 * 3600_000), i)
    buckets = new Array(days).fill(0)
    for (const v of wVisits) { const idx = dateIndex.get(localDate(v.created_at)); if (idx != null) buckets[idx]++ }
    highlightIdx = days - 1
    sparkLeft = 'Visitors per day'
  }
  const maxBucket = Math.max(1, ...buckets)
  const barGap = buckets.length > 10 ? 3 : 8
  const sparkRight = win === 'today' ? 'today' : win === '7d' ? 'last 7 days' : 'last 30 days'
  const barUnit = win === 'today' ? 'this hour' : 'this day'

  const label11: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.faintText }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ ...label11, letterSpacing: '0.16em' }}>Traffic</span>
          <div style={{ display: 'inline-flex', border: `1px solid ${t.border}`, borderRadius: 9999, overflow: 'hidden' }}>
            {([['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']] as [Win, string][]).map(([w, lbl]) => (
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
                {lbl}
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
          <span style={label11}>{sparkLeft}</span>
          <span style={{ fontSize: 12, color: t.faintText }}>{sparkRight}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: barGap, height: 60 }}>
          {buckets.map((c, i) => (
            <div
              key={i}
              title={`${c.toLocaleString()} visit${c === 1 ? '' : 's'} ${barUnit}`}
              style={{
                flex: 1, minWidth: 2, borderRadius: '3px 3px 0 0',
                height: `${Math.max(3, Math.round((c / maxBucket) * 100))}%`,
                background: i === highlightIdx ? t.accent : t.border,
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14, padding: '14px 18px', background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={label11}>Most visited pages</span>
          <span style={{ fontSize: 12, color: t.faintText }}>{sparkRight}</span>
        </div>
        {topPages.length ? topPages.map(([p, c]) => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '6px 0' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</div>
              <div style={{ height: 5, background: t.headerBg, borderRadius: 9999, marginTop: 5, overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(2, Math.round((c / topPageMax) * 100))}%`, height: '100%', background: t.accent, borderRadius: 9999 }} />
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.text, whiteSpace: 'nowrap' }}>
              {c.toLocaleString()} <span style={{ color: t.faintText, fontWeight: 500 }}>· {pct(c)}%</span>
            </div>
          </div>
        )) : (
          <div style={{ fontSize: 13, color: t.faintText }}>No visits in this window yet.</div>
        )}
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
