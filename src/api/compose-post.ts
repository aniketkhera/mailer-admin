// GET /api/admin/compose/post?slug=<slug> as a factory.
//
// The per-post endpoint for the OPTIONAL "Send a blog post" composer mode.
// Admin-gated. The package is CMS-agnostic: this route owns the HTTP shape
// (auth + ?slug parsing + status codes) and delegates the actual CMS read to
// the site-injected cfg.compose.loadPostMarkdown. The site maps its own CMS
// (Sanity, MDX, a DB, …) into { subject, body_md } there.
//
// Response shape (on success): { subject, body_md }
//
// Canonical donor: squashtigers-v2 app/api/admin/compose/post/route.ts
// (which inlined the Sanity specifics this factory pushes into the site).

import { NextRequest, NextResponse } from 'next/server'
import type { MailerConfig } from '../config'
import { createAuth } from '../lib/auth'

export const dynamic = 'force-dynamic'

export function createComposePostRoute(cfg: MailerConfig) {
  const auth = createAuth(cfg)

  async function GET(req: NextRequest) {
    const session = await auth.getAdminSession()
    if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

    const loadPostMarkdown = cfg.compose?.loadPostMarkdown
    if (!loadPostMarkdown) {
      return NextResponse.json({ error: 'Blog compose not enabled.' }, { status: 404 })
    }

    const slug = (req.nextUrl.searchParams.get('slug') || '').trim()
    if (!slug) return NextResponse.json({ error: 'Missing slug.' }, { status: 400 })

    try {
      return NextResponse.json(await loadPostMarkdown(slug))
    } catch (e) {
      console.error('[mailer-admin compose/post] loadPostMarkdown failed:', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Could not load the blog post.' }, { status: 502 })
    }
  }

  return { GET }
}
