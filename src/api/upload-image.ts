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
      // Don't trust the client-declared Content-Type — sniff the magic bytes
      // and store using the SNIFFED type. Rejects a non-image whose name/MIME
      // was spoofed to .png, and stops mislabeled bytes being served publicly.
      const sniffed = sniffImageType(buf)
      if (!sniffed) {
        return NextResponse.json({ error: 'File is not a valid PNG / JPG / GIF / WebP image.' }, { status: 415 })
      }
      const url = await supa.uploadImage(file.name, buf, sniffed)
      return NextResponse.json({ url })
    } catch (e) {
      console.error('[mailer-admin upload-image]', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Upload failed.' }, { status: 500 })
    }
  }

  return { POST }
}

/** Sniff an image type from the leading magic bytes. Returns the canonical
 *  content-type or null if the bytes are not one of the allowed image formats.
 *  (Deliberately does NOT accept SVG — it is an active document.) */
function sniffImageType(buf: ArrayBuffer): string | null {
  const b = new Uint8Array(buf)
  if (b.length < 12) return null
  // PNG  89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  // JPEG FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  // GIF  47 49 46 38 ("GIF8")
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  // WEBP "RIFF"...."WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp'
  return null
}
