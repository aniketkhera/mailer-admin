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
}

export type LeadOption = { value: string; label: string }

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
  /** IANA tz for the Traffic "today" bucket. Default America/New_York. */
  timezone?: string
  /** Address notified on new signups. Default: none. */
  notifyEmail?: string | null
  /** Extra site-local nav tabs appended to the shared AdminNav (e.g. orangish Roadmap). */
  extraNavTabs?: { href: string; label: string }[]
}

export function defineConfig(c: MailerConfig): MailerConfig {
  return c
}

/** Shared "Mailers" Supabase creds — prefer the namespaced MAILER_* names
 *  (orangish-io, which also has a member-app DB) then the generic names
 *  (every other site). Called lazily by each site's config. */
export function resolveSupabaseEnv(): SupabaseEnv {
  return {
    url: process.env.MAILER_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.MAILER_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
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
