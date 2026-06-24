'use client'

// Themed welcome-email editor. Live Markdown → email-safe HTML preview via
// markdownToEmailHtml(md, { linkColor: theme.accent }), wrapped in a brand
// shell that mirrors renderEmailHtml. "Save" upserts via /api/admin/welcome;
// "Send test to me" reuses the composer's test-send endpoint. Canonical
// donor: squashtigers-v2's WelcomeClient — every brand color is now a theme
// token, brand/signup-context come from props. Semantic ok/err greens + reds
// stay literal.

import { useMemo, useState } from 'react'
import type { Theme } from '../../config'
import { markdownToEmailHtml } from '../../lib/email'

export type WelcomeInitial = { subject: string; body_md: string; enabled: boolean }
type Flash = { kind: 'ok' | 'err'; msg: string } | null

export default function WelcomeClient({
  initial, adminEmail, theme, brandName, signupContext,
}: {
  initial: WelcomeInitial
  adminEmail: string
  theme: Theme
  brandName: string
  signupContext: string
}) {
  const t = theme
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body_md)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [busy, setBusy] = useState<null | 'save' | 'test'>(null)
  const [flash, setFlash] = useState<Flash>(null)

  const bodyHtml = useMemo(() => markdownToEmailHtml(body, { linkColor: t.accent }), [body, t.accent])
  const previewHtml = useMemo(
    () => buildPreviewHtml(subject || '(Subject preview)', bodyHtml, { theme: t, brandName, signupContext }),
    [subject, bodyHtml, t, brandName, signupContext],
  )

  // ── themed style consts (close over `t`) ─────────────────────────
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.mutedText, marginBottom: 6 }
  const inputStyle: React.CSSProperties = { width: '100%', padding: '12px 14px', background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 10, fontSize: 14, color: t.text, outline: 'none', boxSizing: 'border-box' }
  const btnStyle: React.CSSProperties = { padding: '11px 22px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }

  async function save() {
    setBusy('save'); setFlash(null)
    try {
      const res = await fetch('/api/admin/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body_md: body, enabled }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setFlash({ kind: 'err', msg: json.error || `Error ${res.status}` }); return }
      setFlash({ kind: 'ok', msg: enabled ? 'Saved — new subscribers will get this email.' : 'Saved as draft (disabled — not sending yet).' })
    } catch {
      setFlash({ kind: 'err', msg: 'Network error — try again.' })
    } finally { setBusy(null) }
  }

  async function sendTest() {
    if (!subject.trim()) { setFlash({ kind: 'err', msg: 'Add a subject first.' }); return }
    setBusy('test'); setFlash(null)
    try {
      const res = await fetch('/api/admin/compose/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body_md: body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setFlash({ kind: 'err', msg: json.error || `Error ${res.status}` }); return }
      setFlash({ kind: 'ok', msg: `Test sent to ${adminEmail}.` })
    } catch {
      setFlash({ kind: 'err', msg: 'Network error — try again.' })
    } finally { setBusy(null) }
  }

  return (
    <div>
      {/* Enable toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 12, marginBottom: 16, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ width: 18, height: 18, accentColor: t.accent }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>
          Auto-send to new subscribers
          <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: t.mutedText, marginTop: 2 }}>
            {enabled ? 'On — every new signup receives this email.' : 'Off — this is just a saved draft; nobody receives it.'}
          </span>
        </span>
      </label>

      {/* Subject */}
      <label style={labelStyle}>Subject</label>
      <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={`Welcome to ${brandName}`} style={inputStyle} />

      {/* Editor + live preview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14, marginTop: 16 }}>
        <div>
          <label style={labelStyle}>Body <span style={{ color: t.faintText, fontWeight: 500 }}>(Markdown)</span></label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={16}
            style={{ ...inputStyle, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, lineHeight: 1.6, resize: 'vertical' }} />
        </div>
        <div>
          <label style={labelStyle}>Preview</label>
          <iframe srcDoc={previewHtml} title="Welcome email preview"
            style={{ width: '100%', height: 360, border: `1px solid ${t.border}`, borderRadius: 12, background: t.panelBg }} />
        </div>
      </div>

      {flash && (
        <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: flash.kind === 'ok' ? '#E9F7EF' : '#FDECEC',
          color: flash.kind === 'ok' ? '#1B7A43' : '#C0392B',
          border: `1px solid ${flash.kind === 'ok' ? '#A9DFBF' : '#F5B7B1'}` }}>
          {flash.msg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button onClick={save} disabled={busy !== null}
          style={{ ...btnStyle, background: t.accent, color: t.accentText, border: `1px solid ${t.accent}`, opacity: busy ? 0.6 : 1 }}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button onClick={sendTest} disabled={busy !== null}
          style={{ ...btnStyle, background: t.panelBg, color: t.text, border: `1px solid ${t.border}`, opacity: busy ? 0.6 : 1 }}>
          {busy === 'test' ? 'Sending…' : `Send test to me`}
        </button>
      </div>
    </div>
  )
}

// Mirror of the email shell for an accurate preview (same approach the
// composer uses). Keep visually in sync with lib/email.ts renderEmailHtml.
// Brand wordmark + accent + signup-context come from the config; the bodyHtml
// already had its links colored with theme.accent by markdownToEmailHtml.
function buildPreviewHtml(
  subject: string,
  bodyHtml: string,
  opts: { theme: Theme; brandName: string; signupContext: string },
): string {
  const { theme: t, brandName, signupContext } = opts
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${t.pageBg};font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.pageBg};">
    <tr><td align="center" style="padding:24px 12px;">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:${t.panelBg};border:1px solid ${t.border};border-radius:14px;overflow:hidden;">
        <tr><td style="padding:20px 32px;border-bottom:1px solid ${t.borderSoft};font-size:13px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:${t.accent};">${esc(brandName)}</td></tr>
        <tr><td style="padding:24px 32px 8px 32px;color:#222;">${bodyHtml}</td></tr>
        <tr><td style="padding:16px 32px 28px 32px;color:${t.mutedText};font-size:12px;line-height:1.6;border-top:1px solid ${t.borderSoft};">
          You&rsquo;re receiving this because ${esc(signupContext)}.<br />
          <a href="#" style="color:${t.mutedText};text-decoration:underline;">Unsubscribe</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
