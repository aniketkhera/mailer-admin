// Server page factory for the Traffic / Visits admin. The consuming site does:
//   import { config } from '@/mailer-admin.config'
//   import { createVisitsPage } from 'mailer-admin/visits/page'
//   export default createVisitsPage(config)
//
// Nav/chrome is provided by the shared admin layout (separate slice); this
// factory loads the last-30-day human visits + funnel signups (both
// property-scoped) and hands the raw rows to the themed client, which does
// all aggregation/rendering. Renders a graceful "not configured" state
// (via supa.configured()) instead of crashing when the Mailers env is
// absent.
//
// Canonical donor: squashtigers-v2 app/admin/visits/page.tsx (single-file).

import { redirect } from 'next/navigation'
import type { MailerConfig } from '../../config'
import { createSupabase } from '../../lib/supabase'
import { createAuth } from '../../lib/auth'
import VisitsClient, { type VisitRow, type SignupRow } from './VisitsClient'

export function createVisitsPage(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)

  // Fetch last-30-day human visits and let the client aggregate in-memory.
  // At a coming-soon page's volume this is a few thousand rows max — cheap.
  // (PostgREST GROUP BY would need an RPC; not worth it at this scale.)
  async function loadVisits(): Promise<VisitRow[]> {
    if (!supa.configured()) return []
    try {
      const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
      const rows = await supa.selectRows<VisitRow>('visits', {
        select: 'path,referrer,utm_source,utm_campaign,region,country,device,is_bot,created_at',
        filters: { property: `eq.${cfg.property}`, is_bot: 'eq.false', created_at: `gte.${since}` },
        order: 'created_at.desc',
        limit: 10000,
      })
      // Exclude admin traffic that may have been logged before the guard
      // was added (only public-site visits count).
      return rows.filter(v => !v.path?.startsWith('/admin'))
    } catch (e) {
      console.error('[mailer-admin visits] load failed:', e instanceof Error ? e.message : e)
      return []
    }
  }

  // Signups in the same 30-day window. Filtered to source='homepage' —
  // the people who came through the on-site form (i.e. through a tracked
  // visit). Migrated / manually-added subscribers aren't part of the
  // visit→signup funnel and would distort conversion (signups with no
  // matching visit). This keeps rates ≤ ~100% and meaningful.
  async function loadSignups(): Promise<SignupRow[]> {
    if (!supa.configured()) return []
    try {
      const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
      return await supa.selectRows<SignupRow>('subscribers', {
        select: 'referrer,utm_source,region,country,tags,subscribed_at',
        filters: { property: `eq.${cfg.property}`, source: 'eq.homepage', subscribed_at: `gte.${since}` },
        limit: 10000,
      })
    } catch (e) {
      console.error('[mailer-admin visits] signups load failed:', e instanceof Error ? e.message : e)
      return []
    }
  }

  return async function VisitsPage() {
    const session = await auth.getAdminSession()
    if (!session) redirect('/admin/login')

    const configured = supa.configured()
    const [visits, signups] = configured
      ? await Promise.all([loadVisits(), loadSignups()])
      : [[] as VisitRow[], [] as SignupRow[]]

    return (
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
        <VisitsClient
          visits={visits}
          signups={signups}
          theme={cfg.theme}
          segments={cfg.segments || []}
          brandName={cfg.brandName}
          appUrl={cfg.appUrl}
          timezone={cfg.timezone || 'America/New_York'}
          notConfigured={!configured}
        />
      </main>
    )
  }
}
