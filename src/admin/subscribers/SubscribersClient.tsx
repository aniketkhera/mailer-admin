'use client'

import { Fragment, useMemo, useState, useRef } from 'react'
import type { Theme, Segment } from '../../config'
import { valuesFromTags, allSegmentValues } from '../../lib/segments'

export type SubscriberRow = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  city: string | null
  country: string | null
  source: string | null
  tags: string[]
  subscribed_at: string
  unsubscribed_at: string | null
  import_metadata: Record<string, string> | null
}

type Filter = 'all' | 'active' | 'unsubscribed'
type SortKey = 'email' | 'name' | 'phone' | 'city' | 'country' | 'subscribed_at'
type SortDir = 'asc' | 'desc'

type ImportResult = {
  imported: number
  unsubscribed_imported?: number
  skipped?: number
  suppressed?: number
}

const COLSPAN = 7

export default function SubscribersClient({
  initialRows, loadError, theme, segments, brandName,
}: { initialRows: SubscriberRow[]; loadError: string | null; theme: Theme; segments: Segment[]; brandName?: string }) {
  const t = theme
  const [rows, setRows] = useState<SubscriberRow[]>(initialRows)
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [segmentFilter, setSegmentFilter] = useState<string>('')
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  // Per-row two-click confirm for Unsub/Resub — inline, no browser
  // confirm() dialog (per [[feedback_no_popups]]).
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('subscribed_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ email: string; first_name: string; last_name: string }>({ email: '', first_name: '', last_name: '' })
  const [editErr, setEditErr] = useState<string | null>(null)

  // ── themed style consts (close over `t`) ─────────────────────────
  const cellInput: React.CSSProperties = { padding: '5px 8px', fontSize: 12.5, border: `1px solid ${t.border}`, borderRadius: 6, background: t.panelBg, width: '100%', boxSizing: 'border-box' }
  const btnPrimarySm: React.CSSProperties = { background: t.accent, border: 'none', color: t.accentText, fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '4px 9px', borderRadius: 6 }
  const btnGhostSm: React.CSSProperties = { background: 'transparent', border: `1px solid ${t.border}`, color: t.mutedText, fontSize: 11, cursor: 'pointer', padding: '3px 9px', borderRadius: 6 }
  const btnLink: React.CSSProperties = { background: 'transparent', border: 'none', color: t.mutedText, fontSize: 12, cursor: 'pointer', padding: '4px 8px' }

  // ── themed primitives (close over `t`) ───────────────────────────
  function Th({ children }: { children?: React.ReactNode }) {
    return <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 10.5, letterSpacing: '0.09em', textTransform: 'uppercase', color: t.mutedText }}>{children}</th>
  }
  function SortTh({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k
    return (
      <th
        onClick={() => toggleSort(k)}
        title="Sort"
        style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 10.5, letterSpacing: '0.09em', textTransform: 'uppercase', color: active ? t.accent : t.mutedText, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
        {label}<span style={{ opacity: active ? 1 : 0.25 }}>{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ▼'}</span>
      </th>
    )
  }
  function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
    return <td style={{ padding: '12px 16px', textAlign: align, color: t.text, verticalAlign: 'middle' }}>{children}</td>
  }
  function Dash() { return <span style={{ color: t.faintText }}>—</span> }
  function SegmentChip({ label }: { label: string }) {
    return (
      <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 9999, background: t.headerBg, border: `1px solid ${t.border}`, color: t.mutedText, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {label}
      </span>
    )
  }
  function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
      <button onClick={onClick} style={{
        padding: '6px 14px', borderRadius: 9999, border: '1px solid', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        borderColor: active ? t.accent : t.border,
        background:  active ? `${t.accent}1f` : t.panelBg,
        color:       active ? t.accent : t.text,
      }}>{children}</button>
    )
  }
  function Count({ n, active }: { n: number; active: boolean }) {
    return <span style={{ fontWeight: 700, opacity: active ? 0.8 : 0.45, marginLeft: 1 }}>{n}</span>
  }
  function Btn({ children, onClick, disabled, type = 'button', tone = 'primary' }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'; tone?: 'primary' | 'ghost' }) {
    return (
      <button type={type} onClick={onClick} disabled={disabled} style={{
        padding: '8px 14px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
        background: tone === 'primary' ? t.accent : 'transparent',
        color:      tone === 'primary' ? t.accentText : t.text,
        border:     tone === 'primary' ? 'none' : `1px solid ${t.border}`,
      }}>{children}</button>
    )
  }
  function Input({ label, value, onChange, type = 'text', required, hint, style }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; hint?: string; style?: React.CSSProperties }) {
    return (
      <div style={style}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: t.mutedText, marginBottom: 4 }}>{label}</label>
        <input type={type} required={required} value={value} onChange={e => onChange(e.target.value)}
          style={{ width: '100%', padding: '9px 12px', fontSize: 13, border: `1px solid ${t.border}`, borderRadius: 8, background: t.panelBg, boxSizing: 'border-box' }} />
        {hint && <div style={{ fontSize: 11, color: t.mutedText, marginTop: 3 }}>{hint}</div>}
      </div>
    )
  }
  function SegmentField({ value, onChange, hint }: { value: string; onChange: (v: string) => void; hint?: string }) {
    // Field label: a single configured segment uses its own label (e.g. "Sport"); else "Segment".
    const fieldLabel = segments.length === 1 ? segments[0].label : 'Segment'
    return (
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: t.mutedText, marginBottom: 4 }}>
          {fieldLabel} <span style={{ fontWeight: 400, color: t.faintText }}>(optional)</span>
        </label>
        <select value={value} onChange={e => onChange(e.target.value)}
          style={{ width: '100%', padding: '9px 12px', fontSize: 13, border: `1px solid ${t.border}`, borderRadius: 8, background: t.panelBg, boxSizing: 'border-box' }}>
          <option value="">— None —</option>
          {allSegmentValues(segments).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {hint && <div style={{ fontSize: 11, color: t.mutedText, marginTop: 3 }}>{hint}</div>}
      </div>
    )
  }
  function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
    return (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: t.panelBg, borderRadius: 14, padding: 24, maxWidth: 480, width: '100%' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 14px 0', color: t.text }}>{title}</h2>
          {children}
        </div>
      </div>
    )
  }

  // ── detail panel (expanded row) ────────────────────────────────────
  function DetailPanel({ r }: { r: SubscriberRow }) {
    const meta = r.import_metadata || {}
    const entries = Object.entries(meta)
    const segVals = valuesFromTags(segments, r.tags)
    return (
      <div style={{ padding: '12px 16px 14px 46px', background: t.headerBg, fontSize: 12.5, color: t.mutedText }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', marginBottom: entries.length ? 10 : 0 }}>
          <KV label="Source" value={r.source} />
          {segVals.length > 0 && (
            <div><span style={{ color: t.mutedText }}>Segment: </span>{segVals.map(s => <SegmentChip key={`${s.key}:${s.value}`} label={s.label} />)}</div>
          )}
          <KV label="Status" value={r.unsubscribed_at ? 'Unsubscribed' : 'Active'} />
          <KV label="Subscribed" value={new Date(r.subscribed_at).toLocaleString()} />
          {r.unsubscribed_at && <KV label="Unsubscribed" value={new Date(r.unsubscribed_at).toLocaleString()} />}
        </div>
        {entries.length > 0 ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: t.mutedText, margin: '4px 0 6px' }}>Imported data</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, max-content) 1fr', gap: '3px 14px', maxWidth: 720 }}>
              {entries.map(([k, v]) => (
                <Fragment key={k}>
                  <div style={{ color: t.mutedText }}>{k}</div>
                  <div style={{ color: t.text, wordBreak: 'break-word' }}>{v}</div>
                </Fragment>
              ))}
            </div>
          </>
        ) : (
          <div style={{ color: t.mutedText }}>No extra imported data for this subscriber.</div>
        )}
      </div>
    )
  }

  function KV({ label, value }: { label: string; value: string | null }) {
    if (!value) return null
    return <div><span style={{ color: t.mutedText }}>{label}: </span><span style={{ color: t.text, fontWeight: 600 }}>{value}</span></div>
  }

  // ── modals ───────────────────────────────────────────────────────
  function AddModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
    const [email, setEmail] = useState('')
    const [first, setFirst] = useState('')
    const [last, setLast] = useState('')
    const [source, setSource] = useState('manual')
    const [segment, setSegment] = useState('')
    const [busyModal, setBusyModal] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    async function submit(e: React.FormEvent) {
      e.preventDefault()
      setBusyModal(true); setErr(null)
      try {
        const res = await fetch('/api/admin/subscribers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, first_name: first, last_name: last, source, segment }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setErr(j.error || 'Could not add.')
          return
        }
        onAdded()
      } finally { setBusyModal(false) }
    }

    return (
      <ModalShell title="Add subscriber" onClose={onClose}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Input label="Email" type="email" required value={email} onChange={setEmail} />
          <div style={{ display: 'flex', gap: 10 }}>
            <Input label="First name" value={first} onChange={setFirst} style={{ flex: 1 }} />
            <Input label="Last name"  value={last}  onChange={setLast}  style={{ flex: 1 }} />
          </div>
          <Input label="Source"  value={source} onChange={setSource} hint='Where they came from — "manual", "homepage", etc.' />
          {segments.length > 0 && <SegmentField value={segment} onChange={setSegment} />}
          {err && <div style={{ color: '#991B1B', fontSize: 13 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <Btn onClick={onClose} tone="ghost" type="button">Cancel</Btn>
            <Btn type="submit" disabled={busyModal}>{busyModal ? 'Adding…' : 'Add'}</Btn>
          </div>
        </form>
      </ModalShell>
    )
  }

  function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (r: ImportResult) => void }) {
    const fileRef = useRef<HTMLInputElement>(null)
    const [source, setSource] = useState('wix-migration')
    const [segment, setSegment] = useState('')
    const [busyModal, setBusyModal] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const [preview, setPreview] = useState<{ rows: number; sample: string[] } | null>(null)

    async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0]
      if (!file) { setPreview(null); return }
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      setPreview({ rows: lines.length - 1, sample: lines.slice(0, 3) })
    }

    async function submit(e: React.FormEvent) {
      e.preventDefault()
      const file = fileRef.current?.files?.[0]
      if (!file) { setErr('Pick a CSV file first.'); return }
      setBusyModal(true); setErr(null)
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('source', source)
        if (segment) fd.append('segment', segment)
        const res = await fetch('/api/admin/subscribers/import', { method: 'POST', body: fd })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) { setErr(j.error || 'Import failed.'); return }
        onImported(j as ImportResult)
      } finally { setBusyModal(false) }
    }

    return (
      <ModalShell title="Import CSV" onClose={onClose}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: t.mutedText, lineHeight: 1.6, margin: 0 }}>
            Needs an email column (<b>email</b> or Wix&apos;s <b>Email 1</b>). Wix exports work as-is — name, phone, city, country and every other column are preserved, and <b>Unsubscribed</b> contacts stay unsubscribed. Existing emails are skipped (no overwrite).
          </p>
          <input type="file" ref={fileRef} accept=".csv,text/csv" onChange={onFileChange}
            style={{ padding: '8px 10px', fontSize: 13, border: `1px solid ${t.border}`, borderRadius: 9, background: t.panelBg }} />
          {preview && (
            <div style={{ fontSize: 12, color: t.mutedText, background: t.headerBg, padding: '8px 12px', borderRadius: 8 }}>
              ~{preview.rows} rows. First lines:<br />
              <code style={{ fontSize: 11 }}>{preview.sample.join('\n')}</code>
            </div>
          )}
          <Input label="Source tag" value={source} onChange={setSource} hint="How these contacts will be tagged in the source column." />
          {segments.length > 0 && <SegmentField value={segment} onChange={setSegment} hint="Applied to every row in this import — e.g. a cricket prospect list → Cricket." />}
          {err && <div style={{ color: '#991B1B', fontSize: 13 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <Btn onClick={onClose} tone="ghost" type="button">Cancel</Btn>
            <Btn type="submit" disabled={busyModal}>{busyModal ? 'Importing…' : 'Import'}</Btn>
          </div>
        </form>
      </ModalShell>
    )
  }

  const sources = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.source) set.add(r.source)
    return Array.from(set).sort()
  }, [rows])

  // Segment values actually present on the list — drives the segment filter
  // options (distinct {value,label} pairs).
  const segmentsInList = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) for (const s of valuesFromTags(segments, r.tags)) map.set(s.value, s.label)
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : 0)
  }, [rows, segments])

  // Filtered by source/segment/search but NOT by subscribe-state — drives
  // the per-filter counts so each chip reflects the current search /
  // source / segment context (and the plain totals when nothing's set).
  const baseFiltered = useMemo(() => rows.filter(r => {
    if (sourceFilter && r.source !== sourceFilter) return false
    if (segmentFilter && !valuesFromTags(segments, r.tags).some(s => s.value === segmentFilter)) return false
    if (search) {
      const q = search.toLowerCase()
      const name = `${r.first_name || ''} ${r.last_name || ''}`.toLowerCase()
      if (!r.email.toLowerCase().includes(q) && !name.includes(q) && !(r.phone || '').toLowerCase().includes(q) && !(r.city || '').toLowerCase().includes(q)) return false
    }
    return true
  }), [rows, search, sourceFilter, segmentFilter, segments])

  const counts = useMemo(() => ({
    all: baseFiltered.length,
    active: baseFiltered.filter(r => !r.unsubscribed_at).length,
    unsubscribed: baseFiltered.filter(r => r.unsubscribed_at).length,
  }), [baseFiltered])

  const visible = useMemo(() => {
    const filtered = baseFiltered.filter(r => {
      if (filter === 'active'       && r.unsubscribed_at) return false
      if (filter === 'unsubscribed' && !r.unsubscribed_at) return false
      return true
    })
    const val = (r: SubscriberRow): string | number => {
      switch (sortKey) {
        case 'email':   return r.email.toLowerCase()
        case 'name':    return `${r.first_name || ''} ${r.last_name || ''}`.trim().toLowerCase()
        case 'phone':   return (r.phone || '').toLowerCase()
        case 'city':    return (r.city || '').toLowerCase()
        case 'country': return (r.country || '').toLowerCase()
        case 'subscribed_at':
        default:        return r.subscribed_at
      }
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return -1 * dir
      if (va > vb) return  1 * dir
      return 0
    })
  }, [baseFiltered, filter, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setSortDir(key === 'subscribed_at' ? 'desc' : 'asc')
  }

  async function refresh() {
    try {
      const res = await fetch('/api/admin/subscribers')
      if (!res.ok) return
      const j = await res.json()
      setRows(j.rows || [])
    } catch {/* swallow */}
  }

  function startEdit(r: SubscriberRow) {
    setConfirmingId(null)
    setEditErr(null)
    setEditingId(r.id)
    setEdit({ email: r.email, first_name: r.first_name || '', last_name: r.last_name || '' })
  }

  async function saveEdit(id: string) {
    const email = edit.email.trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEditErr('Enter a valid email.'); return }
    setBusy(true); setEditErr(null)
    try {
      const res = await fetch(`/api/admin/subscribers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, first_name: edit.first_name.trim(), last_name: edit.last_name.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setEditErr(j.error || 'Save failed.'); return }
      setEditingId(null)
      await refresh()
      setFlash({ kind: 'ok', msg: 'Saved.' })
    } finally { setBusy(false) }
  }

  async function flipSubscribe(r: SubscriberRow) {
    setBusy(true)
    const res = await fetch(`/api/admin/subscribers/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: r.unsubscribed_at ? 'resubscribe' : 'unsubscribe' }),
    })
    setBusy(false)
    setConfirmingId(null)
    if (res.ok) { await refresh(); setFlash({ kind: 'ok', msg: r.unsubscribed_at ? 'Resubscribed.' : 'Unsubscribed.' }) }
    else        { setFlash({ kind: 'err', msg: 'Update failed.' }) }
  }

  async function exportCsv() {
    const header = 'email,first_name,last_name,phone,city,country,source,tags,subscribed_at,unsubscribed_at,import_metadata\n'
    const lines = visible.map(r => [
      r.email,
      r.first_name || '',
      r.last_name || '',
      r.phone || '',
      r.city || '',
      r.country || '',
      r.source || '',
      (r.tags || []).join('|'),
      r.subscribed_at,
      r.unsubscribed_at || '',
      r.import_metadata && Object.keys(r.import_metadata).length ? JSON.stringify(r.import_metadata) : '',
    ].map(csvCell).join(','))
    const blob = new Blob([header + lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const slug = brandName ? brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' : ''
    a.download = `${slug}subscribers-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: t.text, margin: 0 }}>
          Subscribers <span style={{ fontWeight: 600, color: t.mutedText, fontSize: 16 }}>({visible.length})</span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={() => setAddOpen(true)}>+ Add</Btn>
          <Btn onClick={() => setImportOpen(true)} tone="ghost">Import CSV</Btn>
          <Btn onClick={exportCsv} tone="ghost">Export CSV</Btn>
        </div>
      </div>

      {flash && (
        <div style={{ padding: '10px 14px', borderRadius: 9, marginBottom: 14, fontSize: 13,
                      background: flash.kind === 'ok' ? '#DCFCE7' : '#FEE2E2',
                      border: `1px solid ${flash.kind === 'ok' ? '#86EFAC' : '#FCA5A5'}`,
                      color:   flash.kind === 'ok' ? '#166534' : '#991B1B' }}>
          {flash.msg}
        </div>
      )}

      {loadError && (
        <div style={{ padding: '10px 14px', borderRadius: 9, marginBottom: 14, fontSize: 13, background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B' }}>
          {loadError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip active={filter === 'active'}       onClick={() => setFilter('active')}>Active <Count n={counts.active} active={filter === 'active'} /></Chip>
        <Chip active={filter === 'unsubscribed'} onClick={() => setFilter('unsubscribed')}>Unsubscribed <Count n={counts.unsubscribed} active={filter === 'unsubscribed'} /></Chip>
        <Chip active={filter === 'all'}          onClick={() => setFilter('all')}>All <Count n={counts.all} active={filter === 'all'} /></Chip>
        <div style={{ width: 1, height: 22, background: t.border, margin: '0 4px' }} />
        <input
          placeholder="Search email, name, phone or city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: '7px 12px', fontSize: 13, border: `1px solid ${t.border}`, borderRadius: 9999, background: t.panelBg }}
        />
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          style={{ padding: '7px 12px', fontSize: 13, border: `1px solid ${t.border}`, borderRadius: 9999, background: t.panelBg }}>
          <option value="">All sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {segments.length > 0 && segmentsInList.length > 0 && (
          <select value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)}
            style={{ padding: '7px 12px', fontSize: 13, border: `1px solid ${t.border}`, borderRadius: 9999, background: t.panelBg }}>
            <option value="">{segments.length === 1 ? `All ${segments[0].label.toLowerCase()}s` : 'All segments'}</option>
            {segmentsInList.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
      </div>

      <style>{`
        .st-table tbody tr.st-row { transition: background .13s ease }
        .st-table tbody tr.st-row:hover { background: ${t.rowHover} }
        .st-actions { opacity: .5; transition: opacity .13s ease }
        .st-table tr.st-row:hover .st-actions { opacity: 1 }
      `}</style>
      <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 2px rgba(90,50,20,.04), 0 10px 30px rgba(90,50,20,.05)' }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table className="st-table" style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr style={{ background: t.headerBg, borderBottom: `1px solid ${t.border}` }}>
              <Th />
              <SortTh label="Email"   k="email"   />
              <SortTh label="Name"    k="name"    />
              <SortTh label="Phone"   k="phone"   />
              <SortTh label="City"    k="city"    />
              <SortTh label="Country" k="country" />
              <Th />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={COLSPAN} style={{ padding: '36px 16px', textAlign: 'center', color: t.mutedText }}>
                {rows.length === 0 ? 'No subscribers yet.' : 'No matches for these filters.'}
              </td></tr>
            )}
            {visible.map(r => {
              const editing = editingId === r.id
              const confirming = confirmingId === r.id
              const expanded = expandedId === r.id
              return (
                <Fragment key={r.id}>
                  <tr className="st-row" style={{ borderBottom: expanded ? 'none' : `1px solid ${t.borderSoft}`, background: expanded ? t.rowHover : undefined }}>
                    <td style={{ padding: '12px 6px 12px 16px', width: 30 }}>
                      <button onClick={() => setExpandedId(id => (id === r.id ? null : r.id))} aria-label="Toggle details"
                        style={{ background: expanded ? t.accent : 'transparent', border: '1px solid', borderColor: expanded ? t.accent : t.border, borderRadius: 7, width: 22, height: 22, lineHeight: '18px', color: expanded ? t.accentText : t.mutedText, cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: 0 }}>
                        {expanded ? '−' : '+'}
                      </button>
                    </td>
                    <Td>
                      {editing
                        ? <input value={edit.email} onChange={e => setEdit(s => ({ ...s, email: e.target.value }))} style={cellInput} />
                        : <a href={`mailto:${r.email}`} style={{ color: t.text, textDecoration: 'none', fontWeight: 500 }}>{r.email}</a>}
                    </Td>
                    <Td>
                      {editing
                        ? <span style={{ display: 'inline-flex', gap: 6 }}>
                            <input placeholder="First" value={edit.first_name} onChange={e => setEdit(s => ({ ...s, first_name: e.target.value }))} style={{ ...cellInput, width: 88 }} />
                            <input placeholder="Last"  value={edit.last_name}  onChange={e => setEdit(s => ({ ...s, last_name: e.target.value }))}  style={{ ...cellInput, width: 88 }} />
                          </span>
                        : ([r.first_name, r.last_name].filter(Boolean).join(' ') || <Dash />)}
                    </Td>
                    <Td><span style={{ color: t.mutedText, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.phone || <Dash />}</span></Td>
                    <Td><span style={{ color: t.mutedText }}>{r.city || <Dash />}</span></Td>
                    <Td><span style={{ color: t.mutedText, whiteSpace: 'nowrap' }}>{r.country || <Dash />}</span></Td>
                    <Td align="right">
                      {editing ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          {editErr && <span style={{ color: '#991B1B', fontSize: 11, marginRight: 2 }}>{editErr}</span>}
                          <button onClick={() => saveEdit(r.id)} disabled={busy} style={btnPrimarySm}>Save</button>
                          <button onClick={() => { setEditingId(null); setEditErr(null) }} style={btnGhostSm}>Cancel</button>
                        </span>
                      ) : confirming ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: '#991B1B', fontWeight: 600 }}>{r.unsubscribed_at ? 'Resubscribe?' : 'Unsubscribe?'}</span>
                          <button onClick={() => flipSubscribe(r)} disabled={busy} style={btnPrimarySm}>Confirm</button>
                          <button onClick={() => setConfirmingId(null)} style={btnGhostSm}>Cancel</button>
                        </span>
                      ) : (
                        <span className="st-actions" style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
                          <button onClick={() => startEdit(r)} disabled={busy} style={btnLink}>Edit</button>
                          <button
                            onClick={() => {
                              setConfirmingId(r.id)
                              setTimeout(() => setConfirmingId(curr => (curr === r.id ? null : curr)), 5000)
                            }}
                            disabled={busy} style={btnLink}>
                            {r.unsubscribed_at ? 'Resub' : 'Unsub'}
                          </button>
                        </span>
                      )}
                    </Td>
                  </tr>
                  {expanded && (
                    <tr style={{ borderBottom: `1px solid ${t.borderSoft}` }}>
                      <td colSpan={COLSPAN} style={{ padding: 0, background: t.rowHover }}><DetailPanel r={r} /></td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {addOpen && (
        <AddModal onClose={() => setAddOpen(false)} onAdded={async () => { setAddOpen(false); await refresh(); setFlash({ kind: 'ok', msg: 'Subscriber added.' }) }} />
      )}
      {importOpen && (
        <ImportModal onClose={() => setImportOpen(false)} onImported={async (res) => {
          setImportOpen(false); await refresh()
          const bits = [`Imported ${res.imported} subscriber${res.imported === 1 ? '' : 's'}`]
          if (res.unsubscribed_imported) bits.push(`${res.unsubscribed_imported} unsubscribed carried over`)
          if (res.skipped) bits.push(`${res.skipped} already on the list`)
          if (res.suppressed) bits.push(`${res.suppressed} opt-out${res.suppressed === 1 ? '' : 's'} suppressed`)
          setFlash({ kind: 'ok', msg: bits.join(' · ') + '.' })
        }} />
      )}
    </div>
  )
}

// ── module-level helpers (no theme needed) ─────────────────────────

function csvCell(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}
