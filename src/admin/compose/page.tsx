// Server page factory for the mailer composer. The consuming site does:
//   import { config } from '@/mailer-admin.config'
//   import { createComposePage } from 'mailer-admin/compose/page'
//   export default createComposePage(config)
//
// Loads the property's ACTIVE recipients (unsubscribed_at IS NULL), then
// hands them to the themed client along with the signed-in admin's email
// (for the "test sent to <you>" message), the theme, the brand name, and
// the configured tag-segments (which drive the recipient-picker segment
// filter). Renders a graceful "not configured" state instead of crashing
// when the Mailers env is absent.
//
// Nav/chrome is provided by the shared admin layout (separate slice).
// Canonical donor: extonsports-v1 / squashtigers-v2 app/admin/compose/page.tsx.

import { redirect } from 'next/navigation'
import type { MailerConfig } from '../../config'
import { createSupabase } from '../../lib/supabase'
import { createAuth } from '../../lib/auth'
import ComposeClient, { type RecipientRow } from './ComposeClient'

export function createComposePage(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)

  return async function ComposePage() {
    const session = await auth.getAdminSession()
    if (!session) redirect('/admin/login')

    let recipients: RecipientRow[] = []
    let loadError: string | null = null

    if (supa.configured()) {
      try {
        recipients = await supa.selectRows<RecipientRow>('subscribers', {
          select: 'id,email,first_name,last_name,source,tags',
          filters: { property: `eq.${cfg.property}`, unsubscribed_at: 'is.null' },
          order: 'subscribed_at.desc',
          limit: 5000,
        })
      } catch (e) {
        loadError = e instanceof Error ? e.message : 'Could not load recipients.'
      }
    } else {
      loadError = 'Mailer Supabase env not configured on this deployment.'
    }

    return (
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px 48px' }}>
        <ComposeClient
          recipients={recipients}
          loadError={loadError}
          adminEmail={session.email}
          theme={cfg.theme}
          segments={cfg.segments || []}
          brandName={cfg.brandName}
          previewFooter={{
            physicalAddress: cfg.email.physicalAddress,
            signupContext: cfg.email.signupContext || `you signed up at ${cfg.brandName}`,
            contactEmail: cfg.email.contactEmail || null,
          }}
        />
      </main>
    )
  }
}
