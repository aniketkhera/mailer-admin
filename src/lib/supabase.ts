// Thin REST wrapper for the shared Mailers Supabase — config-injected and
// LAZY. Creds are resolved from cfg.supabase() INSIDE each call, so an
// env-incomplete deploy builds + boots (the admin renders a "not
// configured" state) instead of throwing at import. We avoid
// @supabase/supabase-js to stay dependency-light. Server-only — the
// service-role key must never reach the browser.
//
// Canonical donor: orangish-io's lib/mailer-supabase.ts (lazy variant).

import type { MailerConfig, SupabaseEnv } from '../config'

export type RestOptions = {
  select?: string | null
  filters?: Record<string, string>
  order?: string
  limit?: number
  prefer?: string
}

const BUCKET = 'mailer-images'

export type Supabase = ReturnType<typeof createSupabase>

export function createSupabase(cfg: MailerConfig) {
  function env(): { url: string; key: string } {
    const { url, key }: SupabaseEnv = cfg.supabase()
    if (!url || !key) {
      throw new Error(
        `[mailer-admin] Supabase env not configured for property "${cfg.property}" — ` +
        'set MAILER_SUPABASE_URL/KEY or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.',
      )
    }
    return { url, key }
  }

  /** Cheap check for the "not configured" UI state — never throws. */
  function configured(): boolean {
    const { url, key } = cfg.supabase()
    return !!(url && key)
  }

  function buildUrl(table: string, opts: RestOptions = {}): string {
    const { url } = env()
    const u = new URL(`${url}/rest/v1/${table}`)
    if (opts.select) u.searchParams.set('select', opts.select)
    if (opts.filters) for (const [k, v] of Object.entries(opts.filters)) u.searchParams.set(k, v)
    if (opts.order) u.searchParams.set('order', opts.order)
    if (opts.limit != null) u.searchParams.set('limit', String(opts.limit))
    return u.toString()
  }

  function headers(prefer?: string): Record<string, string> {
    const { key } = env()
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    }
    if (prefer) h.Prefer = prefer
    return h
  }

  async function selectRows<T = Record<string, unknown>>(table: string, opts: RestOptions = {}): Promise<T[]> {
    const res = await fetch(buildUrl(table, opts), { headers: headers(), cache: 'no-store' })
    if (!res.ok) throw new Error(`supabase select ${table}: ${res.status} ${await res.text()}`)
    return res.json()
  }

  async function selectOne<T = Record<string, unknown>>(table: string, opts: RestOptions = {}): Promise<T | null> {
    const rows = await selectRows<T>(table, { ...opts, limit: 1 })
    return rows[0] ?? null
  }

  async function insertRow<T = Record<string, unknown>>(
    table: string,
    row: Record<string, unknown>,
    prefer = 'return=representation',
  ): Promise<T | null> {
    const res = await fetch(buildUrl(table), { method: 'POST', headers: headers(prefer), body: JSON.stringify(row) })
    if (!res.ok) throw new Error(`supabase insert ${table}: ${res.status} ${await res.text()}`)
    if (prefer.includes('return=representation')) {
      const arr = await res.json()
      return Array.isArray(arr) ? arr[0] ?? null : arr ?? null
    }
    return null
  }

  async function insertRows(
    table: string,
    rows: Record<string, unknown>[],
    prefer = 'resolution=ignore-duplicates',
  ): Promise<void> {
    if (rows.length === 0) return
    const res = await fetch(buildUrl(table), { method: 'POST', headers: headers(prefer), body: JSON.stringify(rows) })
    if (!res.ok) throw new Error(`supabase bulk insert ${table}: ${res.status} ${await res.text()}`)
  }

  async function updateRows(
    table: string,
    filters: Record<string, string>,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const res = await fetch(buildUrl(table, { filters }), { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) })
    if (!res.ok) throw new Error(`supabase update ${table}: ${res.status} ${await res.text()}`)
  }

  async function uploadImage(filename: string, body: ArrayBuffer | Buffer, contentType: string): Promise<string> {
    const { url, key } = env()
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const objectKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
    const uploadUrl = `${url}/storage/v1/object/${BUCKET}/${objectKey}`
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'false' },
      body: body as BodyInit,
    })
    if (!res.ok) throw new Error(`supabase storage upload: ${res.status} ${await res.text()}`)
    return `${url}/storage/v1/object/public/${BUCKET}/${objectKey}`
  }

  return { property: cfg.property, configured, selectRows, selectOne, insertRow, insertRows, updateRows, uploadImage }
}
