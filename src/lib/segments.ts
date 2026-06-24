// Generic tag-segments (the config-driven generalization of the old
// per-site lib/sports.ts). A segment stores values in subscribers.tags[]
// as `${namespace}${value}` (e.g. 'sport:cricket'). Sites that configure
// no segments get no segment UI.

import type { Segment } from '../config'

function labelize(v: string): string {
  return v.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** The stored tag for a value, e.g. ('sport:', 'cricket') -> 'sport:cricket'.
 *  Returns null if no configured segment owns the value. */
export function segmentTag(segments: Segment[], value: string): string | null {
  const v = (value || '').trim()
  if (!v) return null
  for (const s of segments) if (s.values.includes(v)) return `${s.namespace}${v}`
  return null
}

/** The segment values present on a subscriber's tags[]. */
export function valuesFromTags(segments: Segment[], tags: string[] | null | undefined): { key: string; value: string; label: string }[] {
  const out: { key: string; value: string; label: string }[] = []
  for (const t of tags || []) {
    for (const s of segments) {
      if (t.startsWith(s.namespace)) {
        const value = t.slice(s.namespace.length)
        if (value) out.push({ key: s.key, value, label: labelize(value) })
      }
    }
  }
  return out
}

/** Every configured value across all segments, for filter dropdowns. */
export function allSegmentValues(segments: Segment[]): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  for (const s of segments) for (const v of s.values) out.push({ value: v, label: labelize(v) })
  return out
}
