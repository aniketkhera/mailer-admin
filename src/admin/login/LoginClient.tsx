'use client'

// Themed magic-link sign-in form. THEMED-CLIENT pattern: every brand color
// is t.<token>; semantic success-green / error-red blocks stay literal.
// useSearchParams() requires a Suspense boundary in Next.js 16 — split into
// inner (reads params) + outer (wraps in Suspense). Canonical donor:
// squashtigers-v2 (app/admin/login/page.tsx).

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Theme } from '../../config'

const ERR_COPY: Record<string, string> = {
  expired:         'That sign-in link has expired. Request a new one.',
  malformed:       'That sign-in link is malformed. Request a new one.',
  'bad-signature': 'That sign-in link is invalid. Request a new one.',
  invalid:         'That sign-in link is invalid. Request a new one.',
  'not-allowed':   'Your address is no longer on the admin allowlist.',
}

export default function LoginClient({ theme, brandName }: { theme: Theme; brandName: string }) {
  const t = theme
  return (
    <Suspense fallback={
      <main style={{ minHeight: '100vh', background: t.pageBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
    }>
      <LoginForm theme={theme} brandName={brandName} />
    </Suspense>
  )
}

function LoginForm({ theme, brandName }: { theme: Theme; brandName: string }) {
  const t = theme
  const params = useSearchParams()
  const errKey = params.get('error')
  const errMsg = errKey ? (ERR_COPY[errKey] || 'Sign-in failed. Try again.') : null

  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errLocal, setErrLocal] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setState('sending')
    setErrLocal(null)
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setErrLocal(j.error || 'Could not send sign-in link.')
        setState('error')
        return
      }
      setState('sent')
    } catch {
      setErrLocal('Network error. Try again.')
      setState('error')
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: t.pageBg, color: t.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 16, padding: 36, maxWidth: 440, width: '100%' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: t.accent, marginBottom: 16 }}>
          {brandName} · Admin
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 8px 0', color: t.text }}>
          Sign in
        </h1>
        <p style={{ fontSize: 14, color: t.mutedText, lineHeight: 1.6, margin: '0 0 24px 0' }}>
          Enter your admin email and we&rsquo;ll send you a one-time sign-in link.
        </p>

        {errMsg && (
          <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px 12px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {errMsg}
          </div>
        )}

        {state === 'sent' ? (
          <div style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '14px 16px', borderRadius: 10, fontSize: 14, lineHeight: 1.55 }}>
            Check your inbox. If your address is on the admin allowlist, a sign-in link is on the way.
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="email"
              required
              autoFocus
              placeholder="admin@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={state === 'sending'}
              style={{ padding: '12px 14px', fontSize: 15, border: `1px solid ${t.border}`, borderRadius: 9, background: t.headerBg, color: t.text, outline: 'none' }}
            />
            <button
              type="submit"
              disabled={state === 'sending'}
              style={{ padding: '12px 14px', fontSize: 15, fontWeight: 700, background: t.accent, color: t.accentText, border: 'none', borderRadius: 9, cursor: state === 'sending' ? 'not-allowed' : 'pointer', opacity: state === 'sending' ? 0.6 : 1 }}
            >
              {state === 'sending' ? 'Sending…' : 'Send sign-in link'}
            </button>
            {errLocal && <div style={{ color: '#991B1B', fontSize: 13 }}>{errLocal}</div>}
          </form>
        )}
      </div>
    </main>
  )
}
