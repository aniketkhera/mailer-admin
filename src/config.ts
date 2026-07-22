// Shared types + env adapters for the mailer-admin package.
//
// Pure types + helpers. The only process.env reads here live INSIDE the
// resolve* helpers, which each site calls when it builds its config —
// never at package import. Auth/Supabase creds resolve lazily (see
// lib/auth.ts + lib/supabase.ts) so an env-incomplete deploy still
// builds and renders a "not configured" state instead of crashing.

export type Theme = {
  accent: string       // brand primary (buttons, active state)
  accentText: string   // text on accent
  pageBg: string       // admin page background
  panelBg: string      // card / table background (usually #fff)
  headerBg: string     // table header / subtle band
  border: string       // primary borders
  borderSoft: string   // row dividers
  text: string         // primary text
  mutedText: string    // secondary text
  faintText: string    // em-dashes / placeholders
  rowHover: string     // table row hover background
}

export type Segment = {
  key: string        // 'sport'
  namespace: string  // 'sport:'  (stored in subscribers.tags[] as `${namespace}${value}`)
  label: string      // 'Sport'
  values: string[]   // ['cricket','squash','badminton',...]
  /** Fallback value tagged on a PUBLIC signup that supplies no segment value
   *  and matches no segment-named UTM (e.g. a squash-only launch site defaults
   *  every organic signup to sport:squash). Must be one of `values`. */
  default?: string
}

export type LeadOption = { value: string; label: string }

/** A blog/CMS post in the optional "Send a blog post" composer picker. The
 *  heavy body is fetched on demand (loadPostMarkdown) when a post is chosen,
 *  so this list stays light + serializable. The package is CMS-agnostic —
 *  the site maps its own CMS records into this shape. */
export type PostListItem = {
  id: string
  title: string
  slug: string
  publishedAt: string | null
  category: string | null
  excerpt: string | null
  cover: string | null
}

export type SupabaseEnv = { url?: string; key?: string }

export type MailerConfig = {
  property: string
  brandName: string
  appUrl: string
  /** LAZY — resolved at call time, never at import (env-incomplete deploys still build). */
  supabase: () => SupabaseEnv
  auth: { secret?: string; adminEmails: string; cookieName: string }
  resend: { apiKey?: string; from: string }
  /** Email-shell details for sends. physicalAddress is CAN-SPAM mandatory. */
  email: {
    physicalAddress: string
    replyTo?: string
    contactEmail?: string
    /** Footer "you're receiving this because <signupContext>". Default: "you signed up at <brandName>". */
    signupContext?: string
    /** Optional absolute URL to a brand logo shown in the email header, above
     *  the brand name. Must be a full https:// URL (email clients can't resolve
     *  relative paths). Omit → header shows the brand-name text only (unchanged). */
    logoUrl?: string
  }
  theme: Theme
  /** Tag-segments surfaced in the admin (e.g. sport interest). Default: none → the UI hides. */
  segments?: Segment[]
  /** Lead-capture contact form (e.g. PEAC "Schedule an evaluation"). Default: disabled. */
  leads?: { enabled: boolean; table: string; interestOptions: LeadOption[] }
  /** 'email-or-phone' lets the public form accept a phone in the contact field. Default 'email'. */
  contactMode?: 'email' | 'email-or-phone'
  /** Hidden honeypot field name; a non-empty value on public signup is treated
   *  as a bot and silently dropped (still returns success). e.g. 'company'. */
  honeypotField?: string
  /** Extra public-signup form fields to record as subscriber tags, e.g.
   *  [{ field: 'zipCode', prefix: 'zip:' }] → tags ['zip:08540']. */
  signupTags?: { field: string; prefix: string }[]
  /** Send the welcome email on new signup. Default: true. */
  welcomeEmails?: boolean
  /** Extra site-local user-agent pattern flagged as a bot, OR'd with the
   *  package's shared BOT_RE at insert time (`visits.is_bot`). Rows are still
   *  STORED — is_bot only excludes them from the human-traffic reports.
   *
   *  For site-specific fingerprints that must NOT apply portfolio-wide. The
   *  motivating case: squashtigers is hit by a headless fleet presenting
   *  `X11; Linux x86_64` + Chrome, which asserts `document.referrer =
   *  google.com` (the tracker stores that verbatim, so it can't be trusted).
   *  Measured 2026-07-17: 12/12 such beacons claimed google.com and landed on
   *  a blog post, while 0/3 real visitors did — a clean split. Desktop Linux
   *  is ~0% of a junior-squash audience, so the rule is safe THERE and wrong
   *  for a developer-facing site like orangish.io. Hence per-site, never shared.
   *
   *  Caveat: a user-agent is a fingerprint, and fingerprints drift. If the
   *  google.com share climbs back up, this stopped matching — re-check the
   *  transport before widening it. Default: none. */
  extraBotPattern?: RegExp

  /** IANA tz for the Traffic "today" bucket. Default America/New_York. */
  timezone?: string
  /** Address notified on new signups. Default: none. */
  notifyEmail?: string | null
  /** Extra site-local nav tabs appended to the shared AdminNav (e.g. orangish Roadmap). */
  extraNavTabs?: { href: string; label: string }[]
  /** OPTIONAL "Send a blog post" composer mode. The package stays CMS-agnostic:
   *  the site injects both functions (Sanity, MDX, a DB, …). When `loadPosts`
   *  is set the composer surfaces a Newsletter|Blog-post toggle + post picker;
   *  picking a post calls the per-post route which delegates to
   *  `loadPostMarkdown`. Omit entirely → composer is newsletter-only. */
  compose?: {
    /** List published posts for the picker. Failure → empty picker (never breaks
     *  the newsletter composer). Server-side, called in the compose page. */
    loadPosts?: () => Promise<PostListItem[]>
    /** Render one post (by slug) into the Markdown the composer speaks +
     *  a subject. Called by the per-post route on selection. */
    loadPostMarkdown?: (slug: string) => Promise<{ subject: string; body_md: string }>
  }
}

export function defineConfig(c: MailerConfig): MailerConfig {
  return c
}

/** Shared "Mailers" Supabase creds. Resolved as an ATOMIC PAIR so a partial
 *  env can never mix a URL from one project with a service-role key from
 *  another: if the namespaced MAILER_SUPABASE_URL is present (orangish-io,
 *  which ALSO has a separate member-app DB under the generic names) we take
 *  the MAILER_* url+key together; otherwise we fall back to the generic
 *  pair together (every other site, which has a single DB). This prevents
 *  the dangerous crossover where a dropped MAILER_* var silently pointed
 *  mailer traffic at the member-app credentials. Called lazily by each
 *  site's config. */
export function resolveSupabaseEnv(): SupabaseEnv {
  if (process.env.MAILER_SUPABASE_URL) {
    return {
      url: process.env.MAILER_SUPABASE_URL,
      key: process.env.MAILER_SUPABASE_SERVICE_ROLE_KEY,
    }
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
}

/** Admin allowlist fallback chain so each site keeps its EXISTING env name
 *  (ADMIN_EMAILS / EXTONSPORTS_ADMIN_EMAILS / PEAC_ADMIN_EMAILS / …) with
 *  no Vercel renames. */
export function resolveAdminEmails(property: string): string {
  const up = property.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return (
    process.env.MAILER_ADMIN_EMAILS ||
    process.env[`${up}_ADMIN_EMAILS`] ||
    process.env.ADMIN_EMAILS ||
    ''
  )
}

export const DEFAULT_TIMEZONE = 'America/New_York'

/** Cookie that opts a browser OUT of public-site analytics (set on admin
 *  login + via the Traffic-page toggle). /api/track skips any request
 *  carrying it, keeping the operator's own visits out of the stats. */
export const NOTRACK_COOKIE = 'mailer_notrack'
