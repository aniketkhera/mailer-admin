// Server page factory for the welcome-email settings admin. The consuming
// site does:
//   import { config } from '@/mailer-admin.config'
//   import { createWelcomePage } from 'mailer-admin/welcome/page'
//   export default createWelcomePage(config)
//
// Loads the property-scoped welcome_emails row (falling back to a
// brand-named default body) and renders the themed client. Nav/chrome is
// provided by the shared admin layout (separate slice). Renders a graceful
// default when the Mailers env is absent (via supa.configured()) instead of
// crashing. Canonical donor: squashtigers-v2.

import { redirect } from 'next/navigation'
import type { MailerConfig } from '../../config'
import { createSupabase } from '../../lib/supabase'
import { createAuth } from '../../lib/auth'
import { WELCOME_SELECT } from '../../api/welcome'
import WelcomeClient, { type WelcomeInitial } from './WelcomeClient'

/** A neutral, brand-named starter body so a brand-new property has
 *  something sensible to edit. */
function defaultBody(brandName: string): string {
  return `Thanks for joining the ${brandName} mailing list!

You'll be the first to hear about news, updates, and announcements.

— The ${brandName} team`
}

export function createWelcomePage(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)

  return async function WelcomePage() {
    const session = await auth.getAdminSession()
    if (!session) redirect('/admin/login')

    const fallbackBody = defaultBody(cfg.brandName)
    let initial: WelcomeInitial = {
      subject: `Welcome to ${cfg.brandName}`,
      body_md: fallbackBody,
      enabled: false,
    }

    if (supa.configured()) {
      try {
        const row = await supa.selectOne<{ subject: string; body_md: string; enabled: boolean }>('welcome_emails', {
          select: WELCOME_SELECT,
          filters: { property: `eq.${cfg.property}` },
        })
        if (row) initial = { subject: row.subject, body_md: row.body_md || fallbackBody, enabled: row.enabled }
      } catch { /* fall back to defaults */ }
    }

    return (
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: cfg.theme.text, margin: '0 0 6px 0' }}>
          Welcome email
        </h1>
        <p style={{ fontSize: 14, color: cfg.theme.mutedText, margin: '0 0 24px 0', maxWidth: 620, lineHeight: 1.55 }}>
          When enabled, this is sent automatically to each new subscriber the moment they join the mailing list. Edit it here — it&rsquo;s the same Markdown the composer uses.
        </p>
        <WelcomeClient
          initial={initial}
          adminEmail={session.email}
          theme={cfg.theme}
          brandName={cfg.brandName}
          signupContext={cfg.email.signupContext || `you signed up at ${cfg.brandName}`}
        />
      </main>
    )
  }
}
