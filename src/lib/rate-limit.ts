// Best-effort, in-memory, per-serverless-instance rate limiter for the
// PUBLIC endpoints (subscribe / resubscribe / track / unsubscribe). It is a
// cheap speed-bump against a single IP hammering a write endpoint — NOT a
// hard cross-instance guarantee (state lives in module memory and resets on
// cold start, and each serverless instance keeps its own buckets). This
// restores the per-IP throttle the sites had before the mailer-admin
// adoption; the honeypot remains the complementary bot defense on subscribe.

import type { NextRequest } from 'next/server'

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

/** Best-effort client IP from the edge/proxy headers. */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

/**
 * Fixed-window limiter. Returns true when the call is ALLOWED (under the
 * limit) and false when it should be throttled. `limit` requests per
 * `windowMs`.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    // New window. Opportunistically sweep expired buckets so the map can't
    // grow without bound under a spray of distinct keys/IPs.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k)
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (b.count >= limit) return false
  b.count++
  return true
}
