'use client'

import { useState, useMemo, useRef } from 'react'
import type { Theme, Segment } from '../../config'
import { markdownToEmailHtml } from '../../lib/email'
import { valuesFromTags } from '../../lib/segments'

export type RecipientRow = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  source: string | null
  tags: string[]
}

export type PreviewFooter = {
  physicalAddress: string
  signupContext: string
  contactEmail: string | null
}

export default function ComposeClient({
  recipients, loadError, adminEmail, theme, segments, brandName, previewFooter,
}: {
  recipients: RecipientRow[]
  loadError: string | null
  adminEmail: string
  theme: Theme
  segments: Segment[]
  brandName: string
  previewFooter: PreviewFooter
}) {
  const t = theme

  const STARTER_BODY = `# Hello from ${brandName}!

A quick update for the month:

- Cricket nets are now open Mon–Wed evenings
- Squash courts available 7 days/week
- Indoor turf bookings now live for weekend slots

[Book a free trial →](#)

Questions? Just reply to this email.

— The ${brandName} team
`

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState(STARTER_BODY)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(recipients.map(r => r.id)))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [segmentFilter, setSegmentFilter] = useState<string>('')
  const [busy, setBusy] = useState<null | 'test' | 'send'>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── themed button style (closes over `t`) ───────────────────────────
  function btnStyle(tone: 'primary' | 'ghost', disabled = false, size: 'normal' | 'tiny' = 'normal'): React.CSSProperties {
    const padding = size === 'tiny' ? '5px 10px' : '9px 14px'
    const fontSize = size === 'tiny' ? 11 : 13
    return {
      padding, fontSize, fontWeight: 700, borderRadius: 9, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      background: tone === 'primary' ? t.accent : 'transparent',
      color:      tone === 'primary' ? t.accentText : t.mutedText,
      border:     tone === 'primary' ? 'none' : `1px solid ${t.border}`,
      whiteSpace: 'nowrap',
    }
  }
  function Toolbarbtn({ label, onClick, disabled, title }: { label: string; onClick: () => void; disabled?: boolean; title?: string }) {
    return (
      <button onClick={onClick} disabled={disabled} title={title}
        style={{ padding: '4px 10px', fontSize: 12, fontWeight: 700, background: t.panelBg, color: t.mutedText, border: `1px solid ${t.border}`, borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
        {label}
      </button>
    )
  }

  const sources = useMemo(() => {
    const set = new Set<string>()
    for (const r of recipients) if (r.source) set.add(r.source)
    return Array.from(set).sort()
  }, [recipients])

  // Segment values present among recipients — drives the segment filter so
  // you can send to e.g. everyone tagged Cricket. Distinct {value,label}.
  const segmentsInList = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of recipients) for (const s of valuesFromTags(segments, r.tags)) map.set(s.value, s.label)
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : 0)
  }, [recipients, segments])

  const segmentFilterLabel = useMemo(() => {
    for (const s of segmentsInList) if (s.value === segmentFilter) return s.label
    return segmentFilter
  }, [segmentsInList, segmentFilter])

  const filteredRecipients = useMemo(() => recipients.filter(r => {
    if (sourceFilter && r.source !== sourceFilter) return false
    if (segmentFilter && !valuesFromTags(segments, r.tags).some(s => s.value === segmentFilter)) return false
    if (search) {
      const q = search.toLowerCase()
      const name = `${r.first_name || ''} ${r.last_name || ''}`.toLowerCase()
      if (!r.email.toLowerCase().includes(q) && !name.includes(q)) return false
    }
    return true
  }), [recipients, search, sourceFilter, segmentFilter, segments])

  const bodyHtml = useMemo(() => markdownToEmailHtml(body, { linkColor: t.accent }), [body, t.accent])
  const previewHtml = useMemo(
    () => buildPreviewHtml(subject || '(Subject preview)', bodyHtml, { t, brandName, footer: previewFooter }),
    [subject, bodyHtml, t, brandName, previewFooter],
  )

  function insertAtCursor(snippet: string) {
    const ta = textareaRef.current
    if (!ta) { setBody(b => b + '\n' + snippet); return }
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const next = body.slice(0, start) + snippet + body.slice(end)
    setBody(next)
    // Restore focus + cursor after React rerenders.
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + snippet.length
      ta.setSelectionRange(pos, pos)
    })
  }

  // Wrap the current selection in before/after markers (e.g. **…** for bold).
  // With no selection, drops in a placeholder and selects it for quick editing.
  function wrapSelection(before: string, after: string, placeholder: string) {
    const ta = textareaRef.current
    if (!ta) { setBody(b => b + before + placeholder + after); return }
    const start = ta.selectionStart, end = ta.selectionEnd
    const inner = body.slice(start, end) || placeholder
    const next = body.slice(0, start) + before + inner + after + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      ta.focus()
      const s = start + before.length
      ta.setSelectionRange(s, s + inner.length)
    })
  }

  // Turn the selected text into a Markdown link, prompting for the URL.
  function insertLink() {
    const ta = textareaRef.current
    const start = ta ? ta.selectionStart : body.length
    const end   = ta ? ta.selectionEnd : body.length
    const sel = body.slice(start, end)
    let url = (window.prompt('Link URL', 'https://') || '').trim()
    if (!url || url === 'https://') return
    if (!/^(https?:|mailto:)/i.test(url)) url = 'https://' + url.replace(/^\/+/, '')
    const label = sel || 'link text'
    const snippet = `[${label}](${url})`
    const next = body.slice(0, start) + snippet + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      if (!ta) return
      ta.focus()
      const s = start + 1
      ta.setSelectionRange(s, s + label.length)
    })
  }

  async function uploadImage(file: File) {
    setImageUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/upload-image', { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok || !j.url) {
        setFlash({ kind: 'err', msg: j.error || 'Image upload failed.' })
        return
      }
      const alt = file.name.replace(/\.[^.]+$/, '')
      insertAtCursor(`\n\n![${alt}](${j.url})\n\n`)
    } catch {
      setFlash({ kind: 'err', msg: 'Image upload failed.' })
    } finally {
      setImageUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function insertYouTube() {
    const url = youtubeUrl.trim()
    if (!url) return
    const ytRe = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
    const vmRe = /vimeo\.com\/(\d+)/i
    if (!ytRe.test(url) && !vmRe.test(url)) {
      setFlash({ kind: 'err', msg: 'Paste a full YouTube or Vimeo URL.' })
      return
    }
    insertAtCursor(`\n\n${url}\n\n`)
    setYoutubeUrl('')
  }

  async function testSend() {
    if (!subject.trim()) { setFlash({ kind: 'err', msg: 'Add a subject first.' }); return }
    setBusy('test')
    try {
      const res = await fetch('/api/admin/compose/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body_md: body }),
      })
      const j = await res.json()
      setFlash(res.ok ? { kind: 'ok', msg: `Test sent to ${adminEmail}.` } : { kind: 'err', msg: j.error || 'Test failed.' })
    } finally { setBusy(null) }
  }

  async function send() {
    setBusy('send')
    try {
      const res = await fetch('/api/admin/compose/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          body_md: body,
          recipient_ids: Array.from(selected),
          filter_summary: {
            search: search || undefined,
            source: sourceFilter || undefined,
            segment: segmentFilter || undefined,
            count: selected.size,
          },
        }),
      })
      const j = await res.json()
      if (res.ok) {
        setFlash({ kind: 'ok', msg: `Sent to ${j.sent} recipient${j.sent === 1 ? '' : 's'}.${j.failed ? ` ${j.failed} failed.` : ''}` })
        setConfirmSend(false)
      } else {
        setFlash({ kind: 'err', msg: j.error || 'Send failed.' })
      }
    } finally { setBusy(null) }
  }

  const sendDisabled = !subject.trim() || !body.trim() || selected.size === 0 || busy !== null

  return (
    <div>
      {/* ── top bar ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <input
          placeholder="Subject line…"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          style={{ flex: 1, padding: '11px 14px', fontSize: 15, border: `1px solid ${t.border}`, borderRadius: 10, background: t.panelBg, fontWeight: 600, color: t.text }}
        />
        <button
          onClick={testSend}
          disabled={busy !== null}
          style={btnStyle('ghost', busy !== null)}
        >
          {busy === 'test' ? 'Sending…' : 'Test send'}
        </button>
        <button
          onClick={() => setConfirmSend(true)}
          disabled={sendDisabled}
          style={btnStyle('primary', sendDisabled)}
        >
          Send to {selected.size} →
        </button>
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

      {/* ── recipient summary + picker toggle ───────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: t.mutedText }}>
          <strong style={{ color: t.text }}>{selected.size}</strong> of {recipients.length} active subscribers selected
          {sourceFilter && <span> · source: {sourceFilter}</span>}
          {segmentFilter && <span> · segment: {segmentFilterLabel}</span>}
          {search && <span> · search: &ldquo;{search}&rdquo;</span>}
        </div>
        <button onClick={() => setPickerOpen(o => !o)} style={btnStyle('ghost')}>
          {pickerOpen ? 'Hide picker' : 'Pick recipients'}
        </button>
      </div>

      {pickerOpen && (
        <RecipientPicker
          t={t}
          segments={segments}
          btnStyle={btnStyle}
          recipients={filteredRecipients}
          allCount={recipients.length}
          selected={selected}
          setSelected={setSelected}
          search={search} setSearch={setSearch}
          sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
          sources={sources}
          segmentFilter={segmentFilter} setSegmentFilter={setSegmentFilter}
          segmentsInList={segmentsInList}
        />
      )}

      {/* ── two-column editor + preview (stacks on mobile) ──────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14, marginTop: 4 }}>
        {/* Editor pane */}
        <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: `1px solid ${t.borderSoft}`, background: t.headerBg }}>
            <Toolbarbtn label="B" title="Bold — wraps selected text" onClick={() => wrapSelection('**', '**', 'bold text')} />
            <Toolbarbtn label="I" title="Italic — wraps selected text" onClick={() => wrapSelection('*', '*', 'italic text')} />
            <Toolbarbtn label="H2" title="Section heading" onClick={() => insertAtCursor('\n## Heading\n')} />
            <Toolbarbtn label="•" title="Bullet list" onClick={() => insertAtCursor('\n- item\n- item\n')} />
            <Toolbarbtn label="1." title="Numbered list" onClick={() => insertAtCursor('\n1. First item\n2. Second item\n')} />
            <Toolbarbtn label="🔗" title="Insert link — select text first, then add the URL" onClick={insertLink} />
            <Toolbarbtn label="―" title="Divider line" onClick={() => insertAtCursor('\n\n---\n\n')} />
            <div style={{ width: 1, height: 16, background: t.border, margin: '0 4px' }} />
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f) }}
            />
            <Toolbarbtn label={imageUploading ? 'Uploading…' : '📷 Image'} title="Upload an image" onClick={() => fileRef.current?.click()} disabled={imageUploading} />
            <div style={{ width: 1, height: 16, background: t.border, margin: '0 4px' }} />
            <input
              placeholder="Paste YouTube/Vimeo URL…"
              value={youtubeUrl}
              onChange={e => setYoutubeUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertYouTube() } }}
              style={{ flex: 1, padding: '5px 10px', fontSize: 12, border: `1px solid ${t.border}`, borderRadius: 6, background: t.panelBg, color: t.text }}
            />
            <Toolbarbtn label="Insert" title="Insert YouTube / Vimeo video" onClick={insertYouTube} />
          </div>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={e => setBody(e.target.value)}
            style={{ flex: 1, minHeight: 480, padding: '16px 18px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.6, border: 'none', resize: 'vertical', outline: 'none', background: t.panelBg, color: t.text }}
          />
        </div>

        {/* Preview pane */}
        <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${t.borderSoft}`, background: t.headerBg, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.mutedText }}>
            Preview
          </div>
          <iframe
            srcDoc={previewHtml}
            sandbox="allow-popups"
            style={{ flex: 1, minHeight: 480, width: '100%', border: 'none', background: t.pageBg }}
            title="Email preview"
          />
        </div>
      </div>

      {confirmSend && (
        <ConfirmSendModal
          t={t}
          btnStyle={btnStyle}
          subject={subject}
          recipientCount={selected.size}
          onCancel={() => setConfirmSend(false)}
          onConfirm={send}
          busy={busy === 'send'}
        />
      )}
    </div>
  )
}

// ── Recipient picker (inline) ──────────────────────────────────────

type BtnStyle = (tone: 'primary' | 'ghost', disabled?: boolean, size?: 'normal' | 'tiny') => React.CSSProperties

function RecipientPicker({
  t, segments, btnStyle,
  recipients, allCount, selected, setSelected, search, setSearch, sourceFilter, setSourceFilter, sources,
  segmentFilter, setSegmentFilter, segmentsInList,
}: {
  t: Theme
  segments: Segment[]
  btnStyle: BtnStyle
  recipients: RecipientRow[]
  allCount: number
  selected: Set<string>
  setSelected: (s: Set<string>) => void
  search: string; setSearch: (s: string) => void
  sourceFilter: string; setSourceFilter: (s: string) => void
  sources: string[]
  segmentFilter: string; setSegmentFilter: (s: string) => void
  segmentsInList: { value: string; label: string }[]
}) {
  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }
  function selectAll()    { setSelected(new Set(recipients.map(r => r.id))) }
  function selectNone()   { setSelected(new Set()) }
  function selectVisible(){ setSelected(new Set([...selected, ...recipients.map(r => r.id)])) }
  // Field label: a single configured segment uses its own label (e.g. "All sports"); else "All segments".
  const allSegmentsLabel = segments.length === 1 ? `All ${segments[0].label.toLowerCase()}s` : 'All segments'
  return (
    <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 10, marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, padding: '12px 14px', borderBottom: `1px solid ${t.borderSoft}`, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '7px 12px', fontSize: 13, border: `1px solid ${t.border}`, borderRadius: 9999, background: t.headerBg, color: t.text }}
        />
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          style={{ padding: '7px 12px', fontSize: 13, border: `1px solid ${t.border}`, borderRadius: 9999, background: t.headerBg, color: t.text }}>
          <option value="">All sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {segments.length > 0 && segmentsInList.length > 0 && (
          <select value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)}
            style={{ padding: '7px 12px', fontSize: 13, border: `1px solid ${t.border}`, borderRadius: 9999, background: t.headerBg, color: t.text }}>
            <option value="">{allSegmentsLabel}</option>
            {segmentsInList.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        <button onClick={selectAll}     style={btnStyle('ghost', false, 'tiny')}>All ({allCount})</button>
        <button onClick={selectVisible} style={btnStyle('ghost', false, 'tiny')}>+ Visible ({recipients.length})</button>
        <button onClick={selectNone}    style={btnStyle('ghost', false, 'tiny')}>None</button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {recipients.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: t.mutedText, fontSize: 13 }}>No matches.</div>}
        {recipients.map(r => (
          <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: `1px solid ${t.borderSoft}`, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.email}
              </div>
              <div style={{ fontSize: 11, color: t.mutedText, marginTop: 1 }}>
                {[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}
                {r.source && <> · <span>{r.source}</span></>}
                {valuesFromTags(segments, r.tags).map(s => <span key={`${s.key}:${s.value}`}> · <span style={{ color: t.accent, fontWeight: 700 }}>{s.label}</span></span>)}
              </div>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Confirm send modal ─────────────────────────────────────────────

function ConfirmSendModal({ t, btnStyle, subject, recipientCount, onCancel, onConfirm, busy }: { t: Theme; btnStyle: BtnStyle; subject: string; recipientCount: number; onCancel: () => void; onConfirm: () => void; busy: boolean }) {
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.panelBg, borderRadius: 14, padding: 24, maxWidth: 440, width: '100%' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px 0', color: t.text }}>Send this mailer?</h2>
        <p style={{ fontSize: 13, color: t.mutedText, lineHeight: 1.6, margin: '0 0 16px 0' }}>
          About to send <strong>&ldquo;{subject}&rdquo;</strong> to <strong>{recipientCount}</strong> subscriber{recipientCount === 1 ? '' : 's'}. This can&rsquo;t be undone.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnStyle('ghost', busy)} disabled={busy}>Cancel</button>
          <button onClick={onConfirm} style={btnStyle('primary', busy)} disabled={busy}>
            {busy ? 'Sending…' : `Send to ${recipientCount}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────

// Builds the same wrapped HTML the send pipeline does (so the preview is
// faithful). Duplicates the email shell (lib/email.ts renderEmailHtml)
// client-side rather than importing it because that server lib pulls in
// the Resend SDK + Node features — pull it apart in a follow-up if it ever
// diverges. Every brand color/string flows in from the theme + config.
function buildPreviewHtml(
  subject: string,
  bodyHtml: string,
  opts: { t: Theme; brandName: string; footer: PreviewFooter },
): string {
  const { t, brandName, footer } = opts
  const contactLink = footer.contactEmail
    ? ` &middot; <a href="mailto:${footer.contactEmail}" style="color:${t.mutedText};text-decoration:underline;">Contact us</a>`
    : ''
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${t.pageBg};font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.pageBg};">
<tr><td align="center" style="padding:24px 12px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${t.panelBg};border:1px solid ${t.border};border-radius:14px;overflow:hidden;">
<tr><td style="padding:24px 32px 12px 32px;border-bottom:1px solid ${t.borderSoft};">
<div style="font-size:13px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:${t.accent};">${esc(brandName)}</div>
</td></tr>
<tr><td style="padding:24px 32px 8px 32px;color:${t.text};">${bodyHtml}</td></tr>
<tr><td style="padding:18px 32px 24px 32px;border-top:1px solid ${t.borderSoft};background:${t.pageBg};">
<div style="font-size:12px;line-height:1.65;color:${t.mutedText};">
<p style="margin:0 0 8px 0;"><strong style="color:${t.text};">${esc(brandName)}</strong><br />${esc(footer.physicalAddress)}</p>
<p style="margin:8px 0 0 0;">You&rsquo;re receiving this because ${esc(footer.signupContext)}.<br /><a href="#" style="color:${t.mutedText};text-decoration:underline;">Unsubscribe</a>${contactLink}</p>
</div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
