// Server page factory for the subscribers admin. The consuming site does:
//   import { config } from '@/mailer-admin.config'
//   import { createSubscribersPage } from 'mailer-admin/subscribers/page'
//   export default createSubscribersPage(config)
//
// Nav/chrome is provided by the shared admin layout (separate slice); this
// factory renders just the data + client. Renders a graceful "not
// configured" state (via supa.configured()) instead of crashing when the
// Mailers env is absent.

import { redirect } from 'next/navigation'
import type { MailerConfig } from '../../config'
import { createSupabase } from '../../lib/supabase'
import { createAuth } from '../../lib/auth'
import { SUBSCRIBERS_SELECT, SUBSCRIBERS_ORDER } from '../../api/subscribers'
import SubscribersClient, { type SubscriberRow } from './SubscribersClient'

export function createSubscribersPage(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)

  return async function SubscribersPage() {
    const session = await auth.getAdminSession()
    if (!session) redirect('/admin/login')

    let rows: SubscriberRow[] = []
    let loadError: string | null = null

    if (supa.configured()) {
      try {
        // MUST paginate: a single select stops at PostgREST's 1000-row cap.
        // On 2026-10-26 squashtigers reached 1,035 rows and this page showed
        // "All 1000 / Active 885 / Unsubscribed 115" with the 35 oldest rows
        // missing — the client derives every count from the rows it is given.
        const res = await supa.selectAll<SubscriberRow>('subscribers', {
          select: SUBSCRIBERS_SELECT,
          filters: { property: `eq.${cfg.property}` },
          order: SUBSCRIBERS_ORDER,
        })
        rows = res.rows
        if (res.capped) console.warn('[mailer-admin subscribers] hit the 100k pagination cap — list is truncated.')
      } catch (e) {
        loadError = e instanceof Error ? e.message : 'Could not load subscribers.'
      }
    } else {
      loadError = 'Mailer Supabase env not configured on this deployment.'
    }

    return (
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
        <SubscribersClient initialRows={rows} loadError={loadError} theme={cfg.theme} segments={cfg.segments || []} brandName={cfg.brandName} />
      </main>
    )
  }
}
