// POST /api/admin/upload-image as a factory — multipart { file }.
//
// Validates (5 MB max, png/jpg/gif/webp) -> uploads to the shared Mailers
// Supabase storage 'mailer-images' bucket -> returns { url } (public URL,
// suitable for dropping into a Markdown ![alt](url) embed).
//
// Canonical donor: squashtigers-v2 app/api/admin/upload-image/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createSupabase } from '../lib/supabase'
import { createAuth } from '../lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export function createUploadImageRoute(cfg: MailerConfig) {
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
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `Image too large (max ${MAX_BYTES / 1024 / 1024} MB).` }, { status: 413 })
    }
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: 'Only PNG / JPG / GIF / WebP allowed.' }, { status: 415 })
    }

    try {
      const buf = await file.arrayBuffer()
      const url = await supa.uploadImage(file.name, buf, file.type)
      return NextResponse.json({ url })
    } catch (e) {
      console.error('[mailer-admin upload-image]', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Upload failed.' }, { status: 500 })
    }
  }

  return { POST }
}
