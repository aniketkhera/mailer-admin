'use client'

// Shared, themed admin nav. Derives the active tab from the current
// pathname (usePathname) so the layout can render it once around every
// child route — no per-page `active` prop. Brand colors come entirely
// from the injected Theme; the email + sign-out form mirror the donor
// (squashtigers-v2 app/admin/layout.tsx).

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Theme } from '../config'

const BASE_TABS: { href: string; label: string }[] = [
  { href: '/admin',             label: 'Dashboard'   },
  { href: '/admin/subscribers', label: 'Subscribers' },
  { href: '/admin/compose',     label: 'Compose'     },
  { href: '/admin/welcome',     label: 'Welcome'     },
  { href: '/admin/sends',       label: 'Sends'       },
  { href: '/admin/visits',      label: 'Traffic'     },
]

// Active when the pathname equals the tab href, or is nested under it.
// '/admin' (Dashboard) must match EXACTLY so it isn't perpetually active.
function isActiveTab(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(href + '/')
}

export function AdminNav({
  theme, brandName, email, extraNavTabs = [],
}: {
  theme: Theme
  brandName: string
  email: string
  extraNavTabs?: { href: string; label: string }[]
}) {
  const t = theme
  const pathname = usePathname() || ''
  const items = [...BASE_TABS, ...extraNavTabs]

  return (
    <header style={{ background: t.panelBg, borderBottom: `1px solid ${t.border}` }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: t.accent, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {brandName} · Admin
        </div>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: '1 1 auto', minWidth: 0 }}>
          {items.map(it => {
            const isActive = isActiveTab(pathname, it.href)
            return (
              <Link key={it.href} href={it.href}
                style={{
                  padding: '7px 14px',
                  borderRadius: 9999,
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  color: isActive ? t.accentText : t.mutedText,
                  background: isActive ? t.accent : 'transparent',
                }}>
                {it.label}
              </Link>
            )
          })}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: t.faintText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{email}</div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, background: 'transparent', color: t.mutedText, border: `1px solid ${t.border}`, borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
