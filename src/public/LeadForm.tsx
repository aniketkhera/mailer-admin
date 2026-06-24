'use client'

// Themed public contact / "Schedule a free evaluation" form. POSTs to
// /api/lead (the createLeadRoute target). Interest options come from
// cfg.leads.interestOptions; every brand color comes from `theme`.
//
// The consuming site renders it from a server component / page, passing the
// config-derived props:
//   <LeadForm
//     theme={cfg.theme}
//     interestOptions={cfg.leads?.interestOptions || []}
//     contactMode={cfg.contactMode}
//   />
//
// Canonical donor: peac-v1 app/components/LeadForm.tsx — de-framer'd and
// parametrized (donor used site-local CSS classes + framer-motion; the
// package inlines themed styles so it's drop-in with no extra deps).

import { useState } from 'react'
import type { Theme, LeadOption } from '../config'

type Status = { kind: 'idle' | 'ok' | 'err'; msg?: string }

export default function LeadForm({
  theme,
  interestOptions = [],
  contactMode = 'email',
  heading = 'Schedule your free evaluation',
  blurb = "Tell us a little about your goals and we'll reach out — no commitment.",
  submitLabel = 'Request my evaluation',
  successMessage = "Got it — we'll reach out shortly.",
  alsoSubscribe = true,
}: {
  theme: Theme
  interestOptions?: LeadOption[]
  contactMode?: 'email' | 'email-or-phone'
  heading?: string
  blurb?: string
  submitLabel?: string
  successMessage?: string
  /** Best-effort add the lead to the mailing list via /api/subscribe. */
  alsoSubscribe?: boolean
}) {
  const t = theme
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setStatus({ kind: 'idle' })

    const form = e.currentTarget
    const data = new FormData(form)
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')

    const payload = {
      name: String(data.get('name') || ''),
      email: String(data.get('email') || ''),
      phone: String(data.get('phone') || ''),
      interest: String(data.get('interest') || ''),
      message: String(data.get('message') || ''),
      referrer: typeof document !== 'undefined' ? document.referrer || null : null,
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
    }

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Something went wrong.')

      // Best-effort: also add them to the mailing list so the lead shows in
      // the admin + gets the welcome email. A failure here doesn't fail the
      // request.
      if (alsoSubscribe) {
        fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: payload.name,
            email: payload.email,
            referrer: payload.referrer,
            utm_source: payload.utm_source,
            utm_medium: payload.utm_medium,
            utm_campaign: payload.utm_campaign,
          }),
        }).catch(() => {})
      }

      setStatus({ kind: 'ok', msg: successMessage })
      form.reset()
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof Error ? err.message : 'Something went wrong.' })
    } finally {
      setSubmitting(false)
    }
  }

  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12.5, fontWeight: 700, color: t.mutedText, marginBottom: 5 }
  const fieldStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 14, border: `1px solid ${t.border}`, borderRadius: 9, background: t.panelBg, color: t.text, boxSizing: 'border-box' }
  const contactType = contactMode === 'email-or-phone' ? 'text' : 'email'
  const contactLabel = contactMode === 'email-or-phone' ? 'Email or phone' : 'Email'

  return (
    <section id="evaluation" style={{ background: t.pageBg, padding: '40px 0' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 20px' }}>
        <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: t.text, margin: '0 0 8px 0' }}>{heading}</h2>
        <p style={{ fontSize: 15, color: t.mutedText, lineHeight: 1.6, margin: '0 0 22px 0' }}>{blurb}</p>

        <form onSubmit={onSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="lead-name" style={labelStyle}>Name</label>
            <input id="lead-name" name="name" type="text" required autoComplete="name" style={fieldStyle} />
          </div>
          <div>
            <label htmlFor="lead-email" style={labelStyle}>{contactLabel}</label>
            <input id="lead-email" name="email" type={contactType} required autoComplete="email" style={fieldStyle} />
          </div>
          <div>
            <label htmlFor="lead-phone" style={labelStyle}>Phone (optional)</label>
            <input id="lead-phone" name="phone" type="tel" autoComplete="tel" style={fieldStyle} />
          </div>
          {interestOptions.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="lead-interest" style={labelStyle}>I&rsquo;m interested in</label>
              <select id="lead-interest" name="interest" defaultValue={interestOptions[0]?.value} style={fieldStyle}>
                {interestOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="lead-message" style={labelStyle}>Anything we should know? (optional)</label>
            <textarea id="lead-message" name="message" rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button
              type="submit"
              disabled={submitting}
              style={{ width: '100%', padding: '12px 16px', fontSize: 15, fontWeight: 700, background: t.accent, color: t.accentText, border: 'none', borderRadius: 10, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}
            >
              {submitting ? 'Sending…' : submitLabel}
            </button>
          </div>
          {status.kind === 'ok' && (
            // SEMANTIC green stays literal.
            <div style={{ gridColumn: '1 / -1', background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '10px 14px', borderRadius: 9, fontSize: 14 }}>
              {status.msg}
            </div>
          )}
          {status.kind === 'err' && (
            // SEMANTIC red stays literal.
            <div style={{ gridColumn: '1 / -1', color: '#991B1B', fontSize: 13.5 }}>{status.msg}</div>
          )}
        </form>
      </div>
    </section>
  )
}
