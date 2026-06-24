'use client'

// Themed PUBLIC signup form. Drop into any property's homepage / footer:
//   import { SubscribeForm } from 'mailer-admin/public/SubscribeForm'
//   <SubscribeForm theme={config.theme} contactMode={config.contactMode}
//                  segments={config.segments} source="homepage" />
//
// Posts to /api/subscribe (the createSubscribeRoute factory). Captures
// referrer + UTM off the current URL at submit time so a signup can be
// attributed to its campaign. EVERY brand color comes from the Theme
// tokens (t.*), matching SubscribersClient; semantic green/red literals
// stay. No Tailwind / per-site CSS — fully self-contained inline styles
// so it themes identically on every property.

import { useState } from 'react'
import type { Theme, Segment } from '../config'
import { allSegmentValues } from '../lib/segments'

// Reads referrer + UTM off the current URL at submit time. Returns only
// the keys actually present so the API's null-defaults stand for the
// rest. Safe on the server (returns {}), though this only runs on click.
function acquisitionFields(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const out: Record<string, string> = {}
  if (document.referrer) out.referrer = document.referrer
  const params = new URLSearchParams(window.location.search)
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const v = params.get(key)
    if (v) out[key] = v
  }
  return out
}

export type SubscribeFormProps = {
  theme: Theme
  /** 'email-or-phone' lets the contact field accept a phone. Default 'email'. */
  contactMode?: 'email' | 'email-or-phone'
  /** Optional segment chooser (e.g. sport interest). Hidden when empty. */
  segments?: Segment[]
  /** Stored in subscribers.source. Default 'homepage'. */
  source?: string
  /** Whether to collect a name field. Default true. */
  collectName?: boolean
  /** Headline copy above the form. */
  heading?: string
  /** Subhead copy. */
  subheading?: string
  /** Button label (idle state). Default 'Subscribe'. */
  buttonLabel?: string
  /** Success message. */
  successMessage?: string
  /** Contact email surfaced in the error fallback. */
  contactEmail?: string
}

export function SubscribeForm({
  theme,
  contactMode = 'email',
  segments = [],
  source = 'homepage',
  collectName = true,
  heading,
  subheading,
  buttonLabel = 'Subscribe',
  successMessage = "You're on the list. We'll be in touch!",
  contactEmail,
}: SubscribeFormProps) {
  const t = theme
  const allowPhone = contactMode === 'email-or-phone'

  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [segment, setSegment] = useState('')

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!contact.trim()) return
    setState('sending')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // `contact` carries an email (or, when allowed, a phone). The
          // route detects which by the presence of '@'.
          contact: contact.trim(),
          ...(collectName && name.trim() ? { name: name.trim() } : {}),
          ...(segment ? { segment } : {}),
          source,
          ...acquisitionFields(),
        }),
      })
      if (!res.ok) throw new Error()
      setState('ok')
    } catch {
      setState('err')
    }
  }

  // ── themed style consts (close over `t`) ────────────────────────────
  const field: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '11px 16px',
    fontSize: 15,
    border: `1px solid ${t.border}`,
    borderRadius: 9999,
    background: t.panelBg,
    color: t.text,
    boxSizing: 'border-box',
    outline: 'none',
  }
  const selectField: React.CSSProperties = {
    ...field,
    flex: 'none',
    width: '100%',
  }
  const button: React.CSSProperties = {
    padding: '11px 24px',
    fontSize: 15,
    fontWeight: 700,
    border: 'none',
    borderRadius: 9999,
    background: t.accent,
    color: t.accentText,
    cursor: state === 'sending' ? 'not-allowed' : 'pointer',
    opacity: state === 'sending' ? 0.6 : 1,
    whiteSpace: 'nowrap',
  }
  const contactType = allowPhone ? 'text' : 'email'
  const contactPlaceholder = allowPhone ? 'Email or phone' : 'your@email.com'

  return (
    <div style={{ width: '100%' }}>
      {(heading || subheading) && (
        <div style={{ marginBottom: 16 }}>
          {heading && (
            <h2 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: t.text }}>
              {heading}
            </h2>
          )}
          {subheading && (
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: t.mutedText }}>{subheading}</p>
          )}
        </div>
      )}

      {state === 'ok' ? (
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 12,
            background: '#DCFCE7',
            border: '1px solid #86EFAC',
            color: '#166534',
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {successMessage}
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {collectName && (
              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={state === 'sending'}
                style={field}
              />
            )}
            <input
              type={contactType}
              required
              inputMode={allowPhone ? 'text' : 'email'}
              placeholder={contactPlaceholder}
              value={contact}
              onChange={e => setContact(e.target.value)}
              disabled={state === 'sending'}
              style={field}
            />
            <button type="submit" disabled={state === 'sending'} style={button}>
              {state === 'sending' ? 'Subscribing…' : buttonLabel}
            </button>
          </div>

          {segments.length > 0 && (
            <select
              value={segment}
              onChange={e => setSegment(e.target.value)}
              disabled={state === 'sending'}
              style={selectField}
              aria-label={segments.length === 1 ? segments[0].label : 'Segment'}
            >
              <option value="">
                {segments.length === 1 ? `${segments[0].label} (optional)` : 'Choose a segment (optional)'}
              </option>
              {allSegmentValues(segments).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
        </form>
      )}

      {state === 'err' && (
        <p style={{ marginTop: 12, fontSize: 14, color: '#991B1B' }}>
          Something went wrong — please try again
          {contactEmail ? (
            <>
              {' '}or email{' '}
              <a href={`mailto:${contactEmail}`} style={{ color: t.accent, textDecoration: 'underline' }}>
                {contactEmail}
              </a>
            </>
          ) : null}
          .
        </p>
      )}

      <p style={{ marginTop: 10, fontSize: 11.5, color: t.faintText }}>No spam. Unsubscribe any time.</p>
    </div>
  )
}

export default SubscribeForm
