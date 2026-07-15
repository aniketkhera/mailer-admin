'use client'

// Themed Traffic / Visits dashboard. Receives raw 30-day visit + funnel
// signup rows (property-scoped by the page factory) and does all the
// aggregation client-side: today/7d/30d stat cards, signup-rate, BarCards
// (region / referrer / device / utm_source), per-segment signup bar cards,
// and conversion-by-source + by-region tables.
//
// Every brand color is a theme token (t.*); semantic green/red stay literal.
// The "today" bucket uses the configured IANA timezone (not a hardcoded ET
// string). The old "Signups by sport" card is generalized to cfg.segments —
// one bar card per configured segment, hidden entirely when none.
//
// Canonical donor: squashtigers-v2 app/admin/visits/page.tsx.

import { useState, useEffect } from 'react'
import type { Theme, Segment } from '../../config'
import { NOTRACK_COOKIE } from '../../config'
import { valuesFromTags } from '../../lib/segments'

export type VisitRow = {
  path: string | null
  referrer: string | null
  utm_source: string | null
  utm_campaign: string | null
  region: string | null
  country: string | null
  device: string | null
  visitor_hash: string | null
  is_bot: boolean
  created_at: string
}

export type SignupRow = {
  referrer: string | null
  utm_source: string | null
  region: string | null
  country: string | null
  tags: string[]
  subscribed_at: string
}

// ───────────────────────── aggregation helpers ─────────────────────────

// Region label: always "<code> · <country>" when both resolve (NJ · US,
// QC · CA, ALX · EG) so every row is uniformly qualified. Region alone if
// no country; "—" if no region.
function regionLabel(r: { region: string | null; country: string | null }): string {
  if (!r.region) return '—'
  return r.country ? `${r.region} · ${r.country}` : r.region
}

// Count rows by a string key (works for any row shape).
function countByKey<T>(rows: T[], key: (r: T) => string): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = key(r)
    m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}

// Join visits + signups by a shared key → conversion rows.
type ConvRow = { label: string; visits: number; signups: number; rate: number | null }
function buildConversion<V, S>(
  visits: V[], signups: S[],
  vKey: (v: V) => string, sKey: (s: S) => string,
): ConvRow[] {
  const v = countByKey(visits, vKey)
  const s = countByKey(signups, sKey)
  const labels = new Set<string>([...v.keys(), ...s.keys()])
  return [...labels]
    .map(label => {
      const visits = v.get(label) || 0
      const signups = s.get(label) || 0
      // rate is null (shown "—") when we have signups but no tracked
      // visits — e.g. migrated/pre-logging subscribers. Avoids a
      // misleading 0% or a divide-by-zero Infinity.
      const rate = visits > 0 ? signups / visits : null
      return { label, visits, signups, rate }
    })
    .filter(r => r.visits > 0 || r.signups > 0)
    .sort((a, b) => b.visits - a.visits || b.signups - a.signups)
}

function tally(rows: VisitRow[], key: (v: VisitRow) => string | null): Array<{ label: string; count: number }> {
  const map = new Map<string, number>()
  for (const r of rows) {
    const k = key(r) || '—'
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

// Collapse a full referrer URL to its hostname for grouping.
function refHost(r: string | null): string {
  if (!r) return 'Direct / none'
  try {
    const h = new URL(r).hostname.replace(/^www\./, '')
    return h || 'Direct / none'
  } catch {
    return r.slice(0, 40)
  }
}

// Derive a display domain from the brand's app URL (e.g.
// "https://www.squashtigers.com" → "squashtigers.com"); falls back to the
// brand name when the URL is missing/unparseable.
function brandDomain(appUrl: string, brandName: string): string {
  try {
    const h = new URL(appUrl).hostname.replace(/^www\./, '')
    return h || brandName
  } catch {
    return brandName
  }
}

// "Don't count my visits" toggle. Sets/clears the notrack cookie this
// browser sends with every /api/track beacon, so the operator's own
// browsing is excluded from the stats. Admin login auto-sets it; this is
// for other devices (phone, incognito) or to turn it back off.
// ── Hourly (hour-of-day) stacked histogram ─────────────────────────────
const HOURLY_COLORS = ['#e0845a', '#5C8A54', '#4A78B5', '#C9A227', '#8A5CB5', '#B3A79E']
type HourlyData = { series: { label: string; color: string; counts: number[] }[]; hourTotals: number[]; max: number }

// Bucket rows into 24 hour-of-day stacks split by keyFn (top-K + "Other").
function buildHourly(rows: VisitRow[], keyFn: (v: VisitRow) => string, hourOf: (iso: string) => number, topK = 5): HourlyData {
  const totalByKey = new Map<string, number>()
  for (const v of rows) { const k = keyFn(v); totalByKey.set(k, (totalByKey.get(k) || 0) + 1) }
  const top = [...totalByKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK).map(([k]) => k)
  const labels = [...top, ...(totalByKey.size > top.length ? ['Other'] : [])]
  const idxOf = new Map<string, number>(top.map((l, i) => [l, i]))
  const otherIdx = labels.length - 1
  const counts: number[][] = labels.map(() => new Array(24).fill(0))
  const hourTotals = new Array(24).fill(0)
  for (const v of rows) {
    const h = hourOf(v.created_at)
    const li = idxOf.has(keyFn(v)) ? idxOf.get(keyFn(v))! : otherIdx
    counts[li][h]++; hourTotals[h]++
  }
  const series = labels.map((label, i) => ({
    label,
    color: label === 'Other' ? HOURLY_COLORS[HOURLY_COLORS.length - 1] : HOURLY_COLORS[Math.min(i, HOURLY_COLORS.length - 2)],
    counts: counts[i],
  }))
  return { series, hourTotals, max: Math.max(1, ...hourTotals) }
}
function hourAxisLabel(h: number): string {
  return h === 0 ? '12a' : h === 6 ? '6a' : h === 12 ? '12p' : h === 18 ? '6p' : h === 23 ? '11p' : ''
}

// Live current-time readout (ticks each second) in the site's timezone —
// pinned to the report header so "today"/"last seen" always have a reference.
// Its own state/interval so the parent (and the charts) don't re-render each
// second. Renders null until mounted to avoid an SSR/client hydration mismatch.
function LiveClock({ t, timezone }: { t: Theme; timezone: string }) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!now) return null
  const s = now.toLocaleString('en-US', {
    timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short',
  })
  return <span style={{ fontSize: 12, color: t.faintText, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{s}</span>
}

function NotrackToggle({ t }: { t: Theme }) {
  const [excluded, setExcluded] = useState<boolean | null>(null)
  useEffect(() => {
    setExcluded(document.cookie.split('; ').some(c => c === `${NOTRACK_COOKIE}=1`))
  }, [])
  if (excluded === null) return null // avoid SSR/client flash until mounted
  function toggle() {
    const next = !excluded
    document.cookie = next
      ? `${NOTRACK_COOKIE}=1; Path=/; Max-Age=63072000; SameSite=Lax`
      : `${NOTRACK_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
    setExcluded(next)
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderRadius: 10, border: `1px solid ${t.border}`, background: t.panelBg, marginBottom: 26 }}>
      <span style={{ fontSize: 13, color: t.mutedText }}>
        This browser is {excluded
          ? <b style={{ color: t.text }}>excluded from</b>
          : <b style={{ color: t.text }}>counted in</b>} traffic.
      </span>
      <button onClick={toggle} style={{
        fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '5px 12px', borderRadius: 7,
        border: excluded ? `1px solid ${t.border}` : 'none',
        background: excluded ? 'transparent' : t.accent,
        color: excluded ? t.mutedText : t.accentText,
      }}>
        {excluded ? 'Start counting it' : "Don't count my visits"}
      </button>
    </div>
  )
}

export default function VisitsClient({
  visits, signups, theme, segments, brandName, appUrl, timezone, notConfigured,
}: {
  visits: VisitRow[]
  signups: SignupRow[]
  theme: Theme
  segments: Segment[]
  brandName: string
  appUrl: string
  timezone: string
  notConfigured?: boolean
}) {
  const t = theme
  const domain = brandDomain(appUrl, brandName)

  // Fold self-referrals into "Direct". When someone clicks page-to-page within
  // the site, document.referrer is the previous same-site page, so the tracker
  // logs this domain as the referrer — internal navigation, not a real source.
  const srcOf = (referrer: string | null): string => {
    const h = refHost(referrer)
    return h === domain || h.endsWith('.' + domain) ? 'Direct / none' : h
  }

  const now = Date.now()
  const within = (ms: number) => visits.filter(v => now - new Date(v.created_at).getTime() <= ms).length
  // "Today" = calendar day in the configured timezone (resets at local
  // midnight), not a rolling 24h window. Compare each visit's local
  // calendar date to today's — DST-proof, no offset math. last7/last30
  // stay rolling (labels say "last N days").
  const localDate = (d: string | number) =>
    new Date(d).toLocaleDateString('en-CA', { timeZone: timezone })
  const todayLocal = localDate(now)
  const inToday = (v: VisitRow) => localDate(v.created_at) === todayLocal
  const inLast = (ms: number) => (v: VisitRow) => now - new Date(v.created_at).getTime() <= ms
  const today = visits.filter(inToday).length
  const last7 = within(7 * 24 * 3600_000)
  const last30 = visits.length

  // Unique visitors = distinct visitor_hash. Only meaningful where most rows
  // in the window are hashed — during the tracker rollout, older rows have no
  // hash, so we gate on ≥50% coverage and otherwise return null ("—") rather
  // than a number that undercounts. Returns "≈N unique" copy for the subline.
  const uniqueSub = (pred: (v: VisitRow) => boolean): string | undefined => {
    const rows = visits.filter(pred)
    if (!rows.length) return undefined
    const hashed = rows.filter(v => v.visitor_hash)
    if (hashed.length / rows.length < 0.5) return undefined
    const n = new Set(hashed.map(v => v.visitor_hash as string)).size
    return `≈${n.toLocaleString()} unique`
  }
  const todayUniqueSub = uniqueSub(inToday)
  const last7UniqueSub = uniqueSub(inLast(7 * 24 * 3600_000))
  const last30UniqueSub = uniqueSub(() => true)

  // New vs returning over the loaded ~30 days, from the stable visitor_hash: a
  // visitor (distinct hash) seen on 2+ distinct days is "returning"; 1 day is
  // "new". Ramps up — older daily-rotating hashes appear on one day each, so
  // they read as "new" until enough stable-hash data accumulates.
  const daysByHash = new Map<string, Set<string>>()
  for (const v of visits) {
    if (!v.visitor_hash) continue
    let s = daysByHash.get(v.visitor_hash)
    if (!s) { s = new Set<string>(); daysByHash.set(v.visitor_hash, s) }
    s.add(localDate(v.created_at))
  }
  let newVisitors = 0, returningVisitors = 0
  for (const s of daysByHash.values()) { if (s.size >= 2) returningVisitors++; else newVisitors++ }
  const nrTotal = newVisitors + returningVisitors

  // Breakdown window: the cards below (region / source / device / campaign /
  // conversion) are scoped to this window — not always 30d. The 30d rows are
  // already loaded, so switching is instant and fully client-side.
  const [win, setWin] = useState<'today' | '7d' | '30d'>('30d')
  const inWin = (ts: string | number) =>
    win === 'today' ? localDate(ts) === todayLocal
    : win === '7d' ? now - new Date(ts).getTime() <= 7 * 24 * 3600_000
    : true
  const wVisits = visits.filter(v => inWin(v.created_at))
  const wSignups = signups.filter(s => inWin(s.subscribed_at))

  // Hour-of-day histograms for the selected window, stacked by source + region.
  // Bucketed by US East Coast time explicitly (not the visitor's/server's zone)
  // so the bars always mean ET hours regardless of who's viewing or where it runs.
  const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false, hourCycle: 'h23' })
  const hourOf = (iso: string) => parseInt(hourFmt.format(new Date(iso)), 10) % 24
  const bySourceHourly = buildHourly(wVisits, v => srcOf(v.referrer), hourOf)
  const byLocationHourly = buildHourly(wVisits, regionLabel, hourOf)

  const byRegion   = tally(wVisits, regionLabel)
  const byReferrer = tally(wVisits, v => srcOf(v.referrer))
  const byDevice   = tally(wVisits, v => v.device)
  const byCampaign = tally(wVisits.filter(v => v.utm_source), v => v.utm_source)

  // Inbound signups by configured segment (the generalization of the old
  // "Signups by sport" card). One bar card per segment, counting each
  // present `${namespace}${value}` tag on homepage signups (a signup may
  // carry more than one). Populated when outreach links carry e.g.
  // ?sport=cricket (or a sport-named UTM). Empty array → the whole row of
  // segment cards is suppressed.
  const segmentCards = segments.map(seg => {
    const m = new Map<string, number>()
    for (const s of wSignups) {
      for (const v of valuesFromTags([seg], s.tags)) m.set(v.label, (m.get(v.label) || 0) + 1)
    }
    const rows = [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
    return { seg, rows, total: rows.reduce((s, r) => s + r.count, 0) }
  })

  // Conversion: visits vs signups, matched by normalized source + region —
  // scoped to the selected breakdown window.
  const convBySource = buildConversion(wVisits, wSignups, v => srcOf(v.referrer), s => srcOf(s.referrer))
  const convByRegion = buildConversion(wVisits, wSignups, regionLabel, regionLabel)
  const overallRate  = last30 > 0 ? signups.length / last30 : null

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '0 0 6px 0' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: t.text, margin: 0 }}>
          Traffic
        </h1>
        <LiveClock t={t} timezone={timezone} />
      </div>
      <p style={{ fontSize: 14, color: t.mutedText, margin: '0 0 16px 0' }}>
        Page views to {domain} — last 30 days, bots excluded; unique visitors shown where tracking coverage allows.
        {' '}For full charts (over-time, real-time) see the Vercel Analytics tab.
      </p>
      <div><NotrackToggle t={t} /></div>

      {notConfigured ? (
        <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 14, padding: '28px 22px', color: t.mutedText, fontSize: 14, lineHeight: 1.6 }}>
          Mailer Supabase env not configured on this deployment.
        </div>
      ) : last30 === 0 ? (
        <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 14, padding: '28px 22px', color: t.mutedText, fontSize: 14, lineHeight: 1.6 }}>
          No visits logged yet. Visits are logged from the public homepage (not the admin) — open the site, then refresh: region / referrer / device breakdowns appear here within a moment.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 28 }}>
            <Stat t={t} label="Visits today"   value={today} tone="accent" sub={todayUniqueSub} />
            <Stat t={t} label="Last 7 days"    value={last7} sub={last7UniqueSub} />
            <Stat t={t} label="Last 30 days"   value={last30} tone="muted" sub={last30UniqueSub} />
            <Stat t={t} label="Signup rate (30d)" display={overallRate == null ? '—' : `${(overallRate * 100).toFixed(1)}%`} value={signups.length} tone="accent" />
          </div>

          {nrTotal > 0 && (
            <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.mutedText }}>New vs returning · last 30 days</span>
                <span style={{ fontSize: 13, color: t.mutedText }}>{Math.round((returningVisitors / nrTotal) * 100)}% returning</span>
              </div>
              <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: t.headerBg }}>
                <div style={{ width: `${(newVisitors / nrTotal) * 100}%`, background: '#4A78B5' }} />
                <div style={{ width: `${(returningVisitors / nrTotal) * 100}%`, background: t.accent }} />
              </div>
              <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ color: t.text }}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: '#4A78B5', marginRight: 5 }} />New <b>{newVisitors.toLocaleString()}</b></span>
                <span style={{ color: t.text }}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: t.accent, marginRight: 5 }} />Returning <b>{returningVisitors.toLocaleString()}</b></span>
                <span style={{ color: t.faintText }}>distinct visitors, by whether they came back on another day</span>
              </div>
            </div>
          )}

          <WindowTabs t={t} win={win} setWin={setWin} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14, marginBottom: 14 }}>
            <StackedHourly t={t} title="By hour of day (ET) · source" data={bySourceHourly} />
            <StackedHourly t={t} title="By hour of day (ET) · location" data={byLocationHourly} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 14, marginBottom: 14 }}>
            <BarCard t={t} title="By region (state · country)" rows={byRegion} total={wVisits.length} />
            <BarCard t={t} title="Where they came from" rows={byReferrer} total={wVisits.length} />
            <BarCard t={t} title="Device" rows={byDevice} total={wVisits.length} />
            <BarCard t={t} title="Campaign (utm_source)" rows={byCampaign} total={byCampaign.reduce((s, r) => s + r.count, 0)} emptyHint="Tag your shared links with ?utm_source=… to see campaigns here." />
            {segmentCards.map(c => (
              <BarCard
                key={c.seg.key}
                t={t}
                title={`Signups by ${c.seg.label.toLowerCase()}`}
                rows={c.rows}
                total={c.total}
                emptyHint={`Tag outreach links with ?${c.seg.key}=… (or a ${c.seg.key}-named utm_source) so ${c.seg.label.toLowerCase()}-driven signups show up here.`}
              />
            ))}
          </div>

          <ConversionCard
            t={t}
            title="Conversion by source — visits vs signups"
            rows={convBySource}
            note="Which channels actually produce signups, not just clicks. Rates firm up as traffic builds."
          />
          <div style={{ height: 14 }} />
          <ConversionCard t={t} title="Conversion by region" rows={convByRegion} />
        </>
      )}
    </>
  )
}

// ───────────────────────── themed presentational cards ─────────────────────────

// Segmented control that re-scopes every breakdown card below to Today / 7d /
// 30d. Client-side only — the rows are already loaded for 30d.
function WindowTabs({ t, win, setWin }: { t: Theme; win: 'today' | '7d' | '30d'; setWin: (w: 'today' | '7d' | '30d') => void }) {
  const opts: Array<['today' | '7d' | '30d', string]> = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0 16px' }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: t.mutedText }}>Breakdown window</span>
      <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
        {opts.map(([k, label]) => {
          const active = win === k
          return (
            <button key={k} onClick={() => setWin(k)} style={{
              fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '6px 13px', borderRadius: 999,
              border: active ? 'none' : `1px solid ${t.border}`,
              background: active ? t.accent : 'transparent',
              color: active ? t.accentText : t.mutedText,
            }}>{label}</button>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ t, label, value, display, sub, tone = 'normal' }: { t: Theme; label: string; value: number; display?: string; sub?: string; tone?: 'normal' | 'muted' | 'accent' }) {
  const color = tone === 'accent' ? t.accent : tone === 'muted' ? t.mutedText : t.text
  return (
    <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.mutedText, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{display ?? value.toLocaleString()}</div>
      {display != null && <div style={{ fontSize: 12, color: t.faintText, marginTop: 2 }}>{value.toLocaleString()} signups</div>}
      {sub && <div style={{ fontSize: 12, color: t.faintText, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function StackedHourly({ t, title, data }: { t: Theme; title: string; data: HourlyData }) {
  const H = 130
  const empty = data.hourTotals.every(n => n === 0)
  return (
    <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.mutedText, marginBottom: 14 }}>
        {title}
      </div>
      {empty ? (
        <div style={{ fontSize: 13, color: t.faintText, lineHeight: 1.5 }}>No visits in this window.</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
            {data.series.map(s => (
              <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: t.mutedText, maxWidth: '100%' }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: H }}>
            {Array.from({ length: 24 }, (_, h) => {
              const hct = data.hourTotals[h]
              const barH = hct ? Math.max(2, Math.round((hct / data.max) * H)) : 0
              return (
                <div key={h} title={`${hourAxisLabel(h) || `${h}:00`} · ${hct} views`} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <div style={{ height: barH, display: 'flex', flexDirection: 'column', borderRadius: '3px 3px 0 0', overflow: 'hidden' }}>
                    {data.series.map(s => (s.counts[h] ? <div key={s.label} style={{ height: `${(s.counts[h] / hct) * 100}%`, background: s.color }} /> : null))}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 2, marginTop: 5 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: t.faintText }}>{hourAxisLabel(h)}</div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function BarCard({ t, title, rows, total, emptyHint }: {
  t: Theme
  title: string
  rows: Array<{ label: string; count: number }>
  total: number
  emptyHint?: string
}) {
  const top = rows.slice(0, 8)
  const max = top.length ? top[0].count : 1
  return (
    <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.mutedText, marginBottom: 14 }}>
        {title}
      </div>
      {top.length === 0 ? (
        <div style={{ fontSize: 13, color: t.faintText, lineHeight: 1.5 }}>{emptyHint || 'No data yet.'}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {top.map(r => {
            const pct = total > 0 ? Math.round((r.count / total) * 100) : 0
            return (
              <div key={r.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                  <span style={{ color: t.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{r.label}</span>
                  <span style={{ color: t.mutedText }}>{r.count} · {pct}%</span>
                </div>
                <div style={{ height: 6, background: t.headerBg, borderRadius: 9999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(3, Math.round((r.count / max) * 100))}%`, background: t.accent, borderRadius: 9999 }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ConversionCard({ t, title, rows, note }: { t: Theme; title: string; rows: ConvRow[]; note?: string }) {
  const top = rows.slice(0, 10)
  return (
    <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: t.mutedText, marginBottom: note ? 6 : 14 }}>
        {title}
      </div>
      {note && <div style={{ fontSize: 12, color: t.faintText, marginBottom: 14, lineHeight: 1.5 }}>{note}</div>}
      {top.length === 0 ? (
        <div style={{ fontSize: 13, color: t.faintText }}>No data yet.</div>
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 360, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: t.mutedText, fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              <th style={{ padding: '4px 0' }}>Source</th>
              <th style={{ padding: '4px 8px', textAlign: 'right' }}>Visits</th>
              <th style={{ padding: '4px 8px', textAlign: 'right' }}>Signups</th>
              <th style={{ padding: '4px 0', textAlign: 'right' }}>Rate</th>
            </tr>
          </thead>
          <tbody>
            {top.map(r => {
              // Highlight a strong converter (≥5% with a meaningful base).
              const strong = r.rate != null && r.rate >= 0.05 && r.visits >= 5
              return (
                <tr key={r.label} style={{ borderTop: `1px solid ${t.borderSoft}` }}>
                  <td style={{ padding: '7px 0', color: t.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{r.label}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', color: t.mutedText }}>{r.visits.toLocaleString()}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', color: t.mutedText }}>{r.signups.toLocaleString()}</td>
                  <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 700, color: r.rate == null ? t.faintText : strong ? '#16A34A' : t.text }}>
                    {r.rate == null ? '—' : `${(r.rate * 100).toFixed(1)}%`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
