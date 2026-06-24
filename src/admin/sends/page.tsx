// Server page factory for the read-only send history. The consuming site does:
//   import { config } from '@/mailer-admin.config'
//   import { createSendsPage } from 'mailer-admin/sends/page'
//   export default createSendsPage(config)
//
// Nav/chrome is provided by the shared admin layout (separate slice); this
// factory renders just the data + client. Loads the property-scoped mailers
// history (last 200). Renders a graceful "not configured" state (via
// supa.configured()) instead of crashing when the Mailers env is absent.

import { redirect } from 'next/navigation'
import type { MailerConfig } from '../../config'
import { createSupabase } from '../../lib/supabase'
import { createAuth } from '../../lib/auth'
import SendsClient, { type MailerRow } from './SendsClient'

export const MAILERS_SELECT =
  'id,subject,body_md,body_html,sent_at,sent_by_email,recipient_count,recipient_emails,filter_json,send_errors'

export function createSendsPage(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)

  return async function SendsPage() {
    const session = await auth.getAdminSession()
    if (!session) redirect('/admin/login')

    let rows: MailerRow[] = []
    let loadError: string | null = null

    if (supa.configured()) {
      try {
        rows = await supa.selectRows<MailerRow>('mailers', {
          select: MAILERS_SELECT,
          filters: { property: `eq.${cfg.property}` },
          order: 'sent_at.desc',
          limit: 200,
        })
      } catch (e) {
        loadError = e instanceof Error ? e.message : 'Could not load send history.'
      }
    } else {
      loadError = 'Mailer Supabase env not configured on this deployment.'
    }

    return (
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
        <SendsClient rows={rows} loadError={loadError} theme={cfg.theme} />
      </main>
    )
  }
}
