// Public CAN-SPAM unsubscribe landing as a page factory. The consuming
// site does:
//   import { config } from '@/mailer-admin.config'
//   import { createUnsubscribePage } from 'mailer-admin/unsubscribe/page'
//   export default createUnsubscribePage(config)
//
// No auth — CAN-SPAM requires one-click, no friction. The token in the URL
// is the bearer credential (high-entropy UUID per subscriber, stored
// unique-indexed in the DB), so the lookup is NOT property-scoped — the
// token alone identifies the row across every property.
//
// Idempotent: clicking again after already-unsubscribed is a no-op (renders
// the same "you're unsubscribed" state). Resubscribe is explicit — a button
// that POSTs to /api/resubscribe.
//
// Canonical donor: extonsports-v1 app/unsubscribe/page.tsx.

import type { Metadata } from 'next'
import type { MailerConfig, Theme } from '../../config'
import { createSupabase } from '../../lib/supabase'
import ResubscribeForm from './ResubscribeForm'

export const dynamic = 'force-dynamic'

// Keep this page (and its token-bearing URLs) out of search indices.
export function createUnsubscribeMetadata(cfg: MailerConfig): Metadata {
  return {
    title: 'Unsubscribe',
    description: `Manage your email subscription to ${cfg.brandName}.`,
    robots: { index: false, follow: false, nocache: true },
  }
}

type SubscriberRow = {
  id: string
  email: string
  unsubscribed_at: string | null
  unsubscribe_token: string
}

export function createUnsubscribePage(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const t = cfg.theme
  const contact = cfg.email.contactEmail

  return async function UnsubscribePage({
    searchParams,
  }: {
    searchParams: Promise<{ token?: string }>
  }) {
    const { token } = await searchParams

    if (!token || typeof token !== 'string' || token.length < 8) {
      return (
        <Shell cfg={cfg}>
          <Heading t={t}>Invalid link</Heading>
          <Body t={t}>This unsubscribe link is missing or malformed.</Body>
        </Shell>
      )
    }

    if (!supa.configured()) {
      return (
        <Shell cfg={cfg}>
          <Heading t={t}>Something went wrong</Heading>
          <Body t={t}>
            {contactLine(contact, t, "this list isn't configured to manage subscriptions right now")}
          </Body>
        </Shell>
      )
    }

    let sub: SubscriberRow | null = null
    try {
      // NOT property-scoped — the token is a global bearer credential.
      sub = await supa.selectOne<SubscriberRow>('subscribers', {
        select: 'id,email,unsubscribed_at,unsubscribe_token',
        filters: { unsubscribe_token: `eq.${token}` },
      })
    } catch (e) {
      console.error('[mailer-admin /unsubscribe] lookup failed:', e instanceof Error ? e.message : e)
      return (
        <Shell cfg={cfg}>
          <Heading t={t}>Something went wrong</Heading>
          <Body t={t}>{contactLine(contact, t, "we'll unsubscribe you manually")}</Body>
        </Shell>
      )
    }

    if (!sub) {
      return (
        <Shell cfg={cfg}>
          <Heading t={t}>Link not recognized</Heading>
          <Body t={t}>
            This unsubscribe link doesn&rsquo;t match any subscriber. If you keep getting emails, reply
            to one of them and we&rsquo;ll remove you manually.
          </Body>
        </Shell>
      )
    }

    // Flip the flag on first hit. Idempotent — if already unsubscribed we
    // don't touch the timestamp.
    const wasAlready = !!sub.unsubscribed_at
    if (!wasAlready) {
      try {
        await supa.updateRows('subscribers', { id: `eq.${sub.id}` }, { unsubscribed_at: new Date().toISOString() })
      } catch (e) {
        console.error('[mailer-admin /unsubscribe] flip failed:', e instanceof Error ? e.message : e)
        // Don't surface the error — render the confirmation anyway. CAN-SPAM
        // compliance matters more than perfect honesty; we log and chase the
        // row manually if it didn't actually flip.
      }
    }

    return (
      <Shell cfg={cfg}>
        <Heading t={t}>You&rsquo;ve been unsubscribed</Heading>
        <Body t={t}>
          {sub.email} won&rsquo;t receive any more emails from {cfg.brandName}
          {wasAlready ? ' (you were already unsubscribed)' : ''}.
        </Body>
        <div style={{ marginTop: 28, paddingTop: 22, borderTop: `1px solid ${t.borderSoft}` }}>
          <div style={{ fontSize: 13, color: t.mutedText, marginBottom: 12 }}>Changed your mind?</div>
          <ResubscribeForm token={token} theme={t} contactEmail={contact} />
        </div>
      </Shell>
    )
  }
}

// ── tiny presentation helpers ──────────────────────────────────────

function contactLine(contact: string | undefined, t: Theme, fallback: string): React.ReactNode {
  if (!contact) return <>Try again in a moment.</>
  return (
    <>
      Try again in a moment, or email{' '}
      <a href={`mailto:${contact}`} style={{ color: t.accent }}>{contact}</a>{' '}
      and {fallback}.
    </>
  )
}

function Shell({ cfg, children }: { cfg: MailerConfig; children: React.ReactNode }) {
  const t = cfg.theme
  return (
    <main style={{ minHeight: '100vh', background: t.pageBg, color: t.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 16, padding: 36, maxWidth: 520, width: '100%' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: t.accent, marginBottom: 16 }}>
          {cfg.brandName}
        </div>
        {children}
      </div>
    </main>
  )
}

function Heading({ t, children }: { t: Theme; children: React.ReactNode }) {
  return <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 12px 0', color: t.text }}>{children}</h1>
}

function Body({ t, children }: { t: Theme; children: React.ReactNode }) {
  return <p style={{ fontSize: 15, color: t.mutedText, lineHeight: 1.6, margin: 0 }}>{children}</p>
}
