// Admin shell + nav factory. The consuming site does:
//   import { config } from '@/mailer-admin.config'
//   import { createAdminLayout } from 'mailer-admin/admin/layout'
//   export default createAdminLayout(config)
//
// Canonical donor: squashtigers-v2 app/admin/layout.tsx (the AdminNav lived
// there and each page passed an `active` prop). Here the layout factory
// resolves the session ONCE and renders a single themed shell + nav around
// every child route; the nav derives its active tab from the pathname (a
// 'use client' AdminNav with usePathname), so individual pages no longer
// pass `active`. The login page deliberately renders without auth — the nav
// returns null when there's no session, and the redirect guard still lives
// in each non-login leaf page (see admin/page.tsx etc.).

import type { MailerConfig, Theme } from '../config'
import { createAuth } from '../lib/auth'
import { AdminNav } from './AdminNav'

export { AdminNav }

export function createAdminLayout(cfg: MailerConfig) {
  const auth = createAuth(cfg)
  const t = cfg.theme

  return async function AdminLayout({ children }: { children: React.ReactNode }) {
    // Resolve the session here (server) so the client nav can render the
    // signed-in email + sign-out without doing its own auth read. Returns
    // null on the login page (no cookie) → nav hides.
    const session = await auth.getAdminSession()

    return (
      <div style={{ minHeight: '100vh', background: t.pageBg, color: t.text }}>
        {session && (
          <AdminNav
            theme={t}
            brandName={cfg.brandName}
            email={session.email}
            extraNavTabs={cfg.extraNavTabs || []}
          />
        )}
        {children}
      </div>
    )
  }
}
