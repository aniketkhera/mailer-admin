'use client'

// Shared visit tracker. Mount ONCE in the site's root layout:
//   import TrackBeacon from 'mailer-admin/TrackBeacon'
//   <body>{children}<TrackBeacon /></body>
//
// Fires a fire-and-forget beacon to /api/track (the package's track route) on
// the FIRST load AND on every client-side route change — usePathname re-runs
// the effect on each soft <Link> navigation, so a visitor's whole journey is
// recorded, not just the page they landed on. (The previous per-site copies
// used useEffect([]) in the layout, which fires once and misses every in-app
// navigation.) Admin paths are never logged; geo (region/country) is added
// server-side from edge headers; visitor_hash is derived server-side too.
//
// Sends the external referrer only on the ENTRY pageview: on a soft in-app
// navigation document.referrer is still the original external page, so sending
// it again would attribute every internal pageview to the entry source. UTM is
// self-limiting — it only appears in the URL on the entry, so reading
// window.location.search per fire naturally captures it once.

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

export default function TrackBeacon() {
  const pathname = usePathname()
  const isEntry = useRef(true)

  useEffect(() => {
    try {
      const path = window.location.pathname
      if (path.startsWith('/admin')) return

      const params = new URLSearchParams(window.location.search)
      const entry = isEntry.current
      isEntry.current = false

      const payload = JSON.stringify({
        path,
        referrer: entry ? (document.referrer || null) : null,
        utm_source: params.get('utm_source'),
        utm_medium: params.get('utm_medium'),
        utm_campaign: params.get('utm_campaign'),
      })

      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }))
      } else {
        fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {})
      }
    } catch {
      // never let analytics break the page
    }
  }, [pathname])

  return null
}
