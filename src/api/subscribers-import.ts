// POST /api/admin/subscribers/import as a factory — Wix-aware, lossless
// CSV import. Canonical donor: squashtigers-v2.
//
// - Accepts native + Wix headers (Email 1, First Name, Phone 1,
//   Address 1 - City/Country, Email subscriber status, Created At,
//   Last Activity Date) via alias maps.
// - Honors "Unsubscribed" (imports already-unsubscribed + suppresses any
//   matching active row), preserves the real signup date, and copies
//   every non-empty source column into import_metadata (jsonb) so nothing
//   is lost. Chunks DB lookups so a large import doesn't blow the URL.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createSupabase } from '../lib/supabase'
import { createAuth } from '../lib/auth'
import { segmentTag } from '../lib/segments'

const EMAIL_KEYS = ['email', 'email_1', 'email_address', 'e-mail', 'e_mail']
const FIRST_KEYS = ['first_name', 'first', 'firstname']
const LAST_KEYS  = ['last_name', 'last', 'lastname']
const PHONE_KEYS = ['phone', 'phone_1', 'phone_number', 'mobile', 'cell']
const CITY_KEYS  = ['city', 'address_1_-_city', 'address_city']
const CTRY_KEYS  = ['country', 'address_1_-_country', 'address_country']
const STATUS_KEYS = ['email_subscriber_status', 'subscriber_status', 'status']
const CREATED_KEYS = ['created_at_(utc+0)', 'created_at', 'date_added']
const UNSUB_DATE_KEYS = ['last_activity_date_(utc+0)', 'unsubscribed_at', 'last_activity_date']

type Candidate = {
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  city: string | null
  country: string | null
  unsubscribed: boolean
  subscribed_at: string | null
  unsubscribed_at: string | null
  import_metadata: Record<string, string>
}

export function createImportRoute(cfg: MailerConfig) {
  const supa = createSupabase(cfg)
  const auth = createAuth(cfg)

  async function POST(req: NextRequest) {
    const session = await auth.getAdminSession()
    if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

    let form: FormData
    try { form = await req.formData() } catch {
      return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 })
    }
    const file = form.get('file')
    const source = (form.get('source') || 'csv-import').toString().trim() || 'csv-import'
    const segTag = segmentTag(cfg.segments || [], (form.get('segment') || '').toString().trim())
    const tags = segTag ? [segTag] : []
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
    }

    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.length === 0) return NextResponse.json({ error: 'CSV had no rows.' }, { status: 400 })

    const original = parsed[0].map(s => s.trim())
    const header = original.map(s => s.toLowerCase().replace(/\s+/g, '_'))

    const emailIdx = findIdx(header, EMAIL_KEYS)
    if (emailIdx < 0) {
      return NextResponse.json({
        error: 'CSV needs an email column (e.g. "email" or "Email 1"). Found: ' + original.join(', '),
      }, { status: 400 })
    }
    const firstIdx = findIdx(header, FIRST_KEYS)
    const lastIdx = findIdx(header, LAST_KEYS)
    const phoneIdx = findIdx(header, PHONE_KEYS)
    const cityIdx = findIdx(header, CITY_KEYS)
    const ctryIdx = findIdx(header, CTRY_KEYS)
    const statusIdx = findIdx(header, STATUS_KEYS)
    const createdIdx = findIdx(header, CREATED_KEYS)
    const unsubDtIdx = findIdx(header, UNSUB_DATE_KEYS)

    const at = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '').trim() : '')

    const seen = new Set<string>()
    const candidates: Candidate[] = []
    for (let i = 1; i < parsed.length; i++) {
      const row = parsed[i]
      const email = at(row, emailIdx).toLowerCase()
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue
      if (seen.has(email)) continue
      seen.add(email)

      const unsubscribed = at(row, statusIdx).toLowerCase() === 'unsubscribed'
      const subscribed_at = parseWixDate(at(row, createdIdx))
      const unsubscribed_at = unsubscribed
        ? (parseWixDate(at(row, unsubDtIdx)) || subscribed_at || new Date().toISOString())
        : null

      const meta: Record<string, string> = {}
      for (let j = 0; j < original.length; j++) {
        const k = original[j]
        const v = (row[j] ?? '').trim()
        if (k && v) meta[k] = v
      }

      candidates.push({
        email,
        first_name: at(row, firstIdx) || null,
        last_name: at(row, lastIdx) || null,
        phone: at(row, phoneIdx) || null,
        city: at(row, cityIdx) || null,
        country: at(row, ctryIdx) || null,
        unsubscribed,
        subscribed_at,
        unsubscribed_at,
        import_metadata: meta,
      })
    }

    if (candidates.length === 0) return NextResponse.json({ error: 'No valid email rows found in CSV.' }, { status: 400 })

    const emails = candidates.map(c => c.email)
    const existingSet = new Set<string>()
    try {
      for (const part of chunk(emails, 200)) {
        const rows = await supa.selectRows<{ email: string }>('subscribers', {
          select: 'email',
          filters: { property: `eq.${cfg.property}`, email: `in.(${part.map(quoteIn).join(',')})` },
        })
        for (const r of rows) existingSet.add(r.email)
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.error('[mailer-admin import] existence check', detail)
      return NextResponse.json({ error: 'Could not check existing subscribers: ' + detail.slice(0, 400) }, { status: 500 })
    }

    const fresh = candidates.filter(c => !existingSet.has(c.email))

    try {
      for (const part of chunk(fresh, 500)) {
        await supa.insertRows('subscribers', part.map(c => ({
          property: cfg.property,
          email: c.email,
          first_name: c.first_name,
          last_name: c.last_name,
          phone: c.phone,
          city: c.city,
          country: c.country,
          source,
          tags,
          subscribed_at: c.subscribed_at || new Date().toISOString(),
          unsubscribed_at: c.unsubscribed_at,
          import_metadata: c.import_metadata,
        })), 'resolution=ignore-duplicates,return=minimal')
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.error('[mailer-admin import] insert', detail)
      return NextResponse.json({ error: 'Insert failed: ' + detail.slice(0, 400) }, { status: 500 })
    }

    const suppressEmails = candidates.filter(c => c.unsubscribed && existingSet.has(c.email)).map(c => c.email)
    let suppressed = 0
    try {
      for (const part of chunk(suppressEmails, 200)) {
        await supa.updateRows('subscribers', {
          property: `eq.${cfg.property}`,
          email: `in.(${part.map(quoteIn).join(',')})`,
          unsubscribed_at: 'is.null',
        }, { unsubscribed_at: new Date().toISOString() })
        suppressed += part.length
      }
    } catch (e) {
      console.error('[mailer-admin import] suppress', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({
      success: true,
      imported: fresh.length,
      unsubscribed_imported: fresh.filter(c => c.unsubscribed).length,
      skipped: candidates.length - fresh.length,
      suppressed,
      total_rows_in_csv: parsed.length - 1,
    })
  }

  return { POST }
}

// ── helpers ──

function findIdx(header: string[], keys: string[]): number {
  for (const k of keys) { const i = header.indexOf(k); if (i >= 0) return i }
  return -1
}
function quoteIn(e: string): string {
  return `"${e.replace(/"/g, '\\"')}"`
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
function parseWixDate(s: string): string | null {
  if (!s) return null
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}Z`
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : iso
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    } else {
      if (c === '"') { inQuotes = true; i++; continue }
      if (c === ',') { row.push(field); field = ''; i++; continue }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
      if (c === '\r') { i++; continue }
      field += c; i++; continue
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim().length > 0))
}
