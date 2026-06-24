I have enough verified ground truth. Key confirmations: (1) the two supabase wrappers are byte-identical except env names + PROPERTY default → env adapter; (2) orangish-io AdminNav hardcodes its tab list (incl. roadmap tabs) → config-driven nav; (3) canonical subscribers SELECT and Wix import are exactly as the map described; (4) auth module reads env names directly at module load, so the package must take them via config rather than fixed `process.env` reads. I have what I need to produce the blueprint.

---

# `mailer-admin` — Extraction Blueprint

A single private, themeable, config-injected package consumed by all 7 sibling sites via `transpilePackages` + a git dependency. The package owns the **entire `/admin` mailing-list + analytics surface and its public `/api` + `/unsubscribe` counterparts**; each site keeps only a ~1-line wrapper per route/page plus one `mailer-admin.config.ts`.

Verified ground truth (read from disk, not just maps):
- `lib/supabase.ts` (squashtigers) and `lib/mailer-supabase.ts` (orangish-io) are **byte-identical** except (a) the two env reads and (b) the `PROPERTY` default string. Same `RestOptions` / `selectRows/selectOne/insertRow/insertRows/updateRows/uploadImage` surface, bucket `'mailer-images'` hardcoded. → one wrapper, env injected.
- `lib/auth.ts` reads `AUTH_SECRET` + the allowlist env **at module load** and hardcodes `SESSION_COOKIE`. → package must take secret/allowlist/cookie via a config object, not fixed `process.env`.
- Canonical subscribers SELECT = `id,email,first_name,last_name,phone,city,country,source,tags,subscribed_at,unsubscribed_at,import_metadata` (squashtigers); the Wix import is the rich one (header aliases, `import_metadata` jsonb, unsub carry-over + suppression, chunked existence check).
- `AdminNav` is **exported from `app/admin/layout.tsx`** in every site and imported by each leaf page with an `active` prop; the item list (incl. orangish-io's roadmap tabs, squashtigers' "Summer 26") is hardcoded inline. → nav must be config-driven with injectable extra tabs.

---

## 1. PACKAGE FILE / EXPORT LAYOUT

Package name: `@orangish/mailer-admin` (private; git dependency). Ships **TypeScript source** (no build step) and is transpiled by each consumer via `transpilePackages`. This matches the family's "no exotic deps" constraint (`node:crypto` + `fetch` + `resend` only).

```
mailer-admin/
├─ package.json                # "type":"module", exports map, peerDeps next/react/resend
├─ tsconfig.json
├─ README.md
└─ src/
   ├─ index.ts                 # re-exports the config type + defineMailerConfig()
   │
   ├─ config/
   │  ├─ types.ts              # MailerConfig, ThemeTokens, SportsConfig, etc. (§2/§3)
   │  ├─ define-config.ts      # defineMailerConfig(input): MailerConfig  (fills defaults)
   │  ├─ env-adapter.ts        # resolveEnv() — handles MAILER_* vs NEXT_PUBLIC_* + 4 allowlist names (§2)
   │  └─ defaults.ts           # DEFAULT_THEME, DEFAULT_SPORTS=[], default starter/welcome bodies
   │
   ├─ lib/                     # ── pure server logic, no React ──
   │  ├─ supabase.ts           # createSupabase(cfg) -> { selectRows, selectOne, insertRow, insertRows, updateRows, uploadImage, supabaseConfigured }
   │  ├─ auth.ts               # createAuth(cfg) -> { isAdmin, signToken, verifyToken, buildSessionCookie, buildClearSessionCookie, SESSION_COOKIE, MAGIC_LINK_TTL, SESSION_TTL }
   │  ├─ auth-guard.ts         # createAuthGuard(cfg) -> getAdminSession()  (reads cfg cookie name)
   │  ├─ send-mailer.ts        # createSendMailer(cfg) -> { sendMailer, sendOne }
   │  ├─ email-template.ts     # renderEmailHtml(cfg, { bodyHtml, unsubscribeUrl }) — THE one shell (§6 dedup)
   │  ├─ markdown.ts           # markdownToEmailHtml(md, { linkColor }) — accent threaded in
   │  ├─ sports.ts             # createSports(cfg.sports) -> { SPORTS, sportTag, sportsFromTags, sportLabel, deriveSport }
   │  ├─ rate-limit.ts         # in-memory fixed-window limiter + clientIp() (from orangish-io)
   │  └─ csv.ts                # parseCsv + parseWixDate + header-alias maps (from squashtigers import)
   │
   ├─ routes/                  # ── handler FACTORIES: (cfg) => { GET?, POST?, PATCH? } ──
   │  ├─ admin/
   │  │  ├─ subscribers.ts        # createSubscribersRoute(cfg)   -> { GET, POST }
   │  │  ├─ subscriber-id.ts      # createSubscriberRoute(cfg)    -> { PATCH }   (flip + inline edit, 409 on dupe)
   │  │  ├─ import.ts             # createImportRoute(cfg)        -> { POST }    (canonical Wix import)
   │  │  ├─ compose-send.ts       # createComposeSendRoute(cfg)   -> { POST }
   │  │  ├─ compose-test.ts       # createTestSendRoute(cfg)      -> { POST }
   │  │  ├─ compose-post.ts       # createComposePostRoute(cfg)   -> { GET }     (OPTIONAL: cfg.postSource adapter)
   │  │  ├─ welcome.ts            # createWelcomeRoute(cfg)       -> { GET, POST }
   │  │  └─ upload-image.ts       # createUploadImageRoute(cfg)   -> { POST }
   │  ├─ auth/
   │  │  ├─ magic-link.ts         # createMagicLinkRoute(cfg)     -> { POST }
   │  │  ├─ verify.ts             # createVerifyRoute(cfg)        -> { GET }
   │  │  └─ logout.ts             # createLogoutRoute(cfg)        -> { POST }
   │  └─ public/
   │     ├─ subscribe.ts          # createSubscribeRoute(cfg)     -> { POST }  (email|contact, geo/UTM, welcome, notify)
   │     ├─ unsubscribe.ts        # createUnsubscribeRoute(cfg)   -> { GET, POST }  (RFC-8058 one-click)
   │     ├─ resubscribe.ts        # createResubscribeRoute(cfg)   -> { POST }
   │     ├─ track.ts              # createTrackRoute(cfg)         -> { POST }  (visits beacon, 204)
   │     └─ lead.ts               # createLeadRoute(cfg)          -> { POST }  (OPTIONAL: cfg.leads.enabled)
   │
   ├─ pages/                   # ── server-component page FACTORIES: (cfg) => async Page ──
   │  ├─ DashboardPage.tsx        # createDashboardPage(cfg)
   │  ├─ LoginPage.tsx            # createLoginPage(cfg)      (client island inside)
   │  ├─ SubscribersPage.tsx      # createSubscribersPage(cfg)
   │  ├─ ComposePage.tsx          # createComposePage(cfg)
   │  ├─ WelcomePage.tsx          # createWelcomePage(cfg)
   │  ├─ SendsPage.tsx            # createSendsPage(cfg)
   │  ├─ VisitsPage.tsx           # createVisitsPage(cfg)
   │  └─ UnsubscribePage.tsx      # createUnsubscribePage(cfg) (public)
   │
   ├─ components/              # ── themeable client components ('use client') ──
   │  ├─ AdminShell.tsx           # <ThemeProvider> wrapper: bg/font + injects CSS vars from cfg.theme
   │  ├─ AdminNav.tsx             # config-driven nav (cfg.brandLabel + cfg.nav.extraTabs)
   │  ├─ ThemeProvider.tsx        # writes cfg.theme tokens to inline `--mt-*` CSS vars on a wrapper div
   │  ├─ SubscribersClient.tsx    # CANONICAL (squashtigers): cols, sort, expand, inline edit, counts
   │  ├─ ComposeClient.tsx        # CANONICAL composer; uses renderEmailHtml for preview (no inline shell)
   │  ├─ WelcomeClient.tsx        # uses renderEmailHtml for preview
   │  ├─ SendsClient.tsx
   │  ├─ VisitsView.tsx           # bar cards + conversion tables (data computed server-side in VisitsPage)
   │  ├─ ResubscribeForm.tsx
   │  ├─ NewsletterForm.tsx       # OPTIONAL package-provided signup form (themeable) — for starsquash/dormant sites
   │  └─ ui/                      # StatCard, FilterChip, BarCard, Modal, ConfirmButton (shared primitives)
   │
   └─ adapters/
      └─ post-source.ts           # PostSource interface { listPosts(), getPost(slug) } — Sanity impl stays site-local
```

**Every public export is a factory taking `cfg`** so nothing reads fixed env or hardcodes brand. The theme reaches string-template code (`markdown.ts`, `email-template.ts`) by **passing `cfg.theme` in**, not via CSS vars (those don't exist in emails). React components get theme via `ThemeProvider` writing `--mt-*` CSS custom properties onto a wrapper, so inline styles reference `var(--mt-accent)` etc.

`package.json` peerDeps: `next` `^16.2.6`, `react` `^19.2.4`, `react-dom`, `resend` `^6.12.4`. No `@supabase/supabase-js` (kept out — pure fetch). Consumers add `"@orangish/mailer-admin": "github:aniketkhera/mailer-admin#<sha>"` and `transpilePackages: ['@orangish/mailer-admin']`.

---

## 2. THE CONFIG CONTRACT

Each site writes one `mailer-admin.config.ts` and calls `defineMailerConfig()`. The **env adapter** lives in the package and is called *by the site's config file* so Vercel env names never change.

```ts
// mailer-admin/src/config/types.ts
export interface MailerConfig {
  // ── identity / property ──
  property: string;                      // from SITE_PROPERTY (NO per-site default in package)
  brandName: string;                     // "Exton Sports Center"
  brandLabel: string;                    // nav chip: "Exton Sports · Admin"
  orgAddress: string;                    // CAN-SPAM footer address
  appUrl: string;                        // public site origin (unsub links, fallbacks)
  contactEmail: string;                  // mailto in footer / unsubscribe page
  notify?: { enabled: boolean; to?: string };   // new-signup admin notification (default off)

  // ── data ──
  supabase: { url: string; key: string };       // resolved by env adapter (handles MAILER_* vs NEXT_PUBLIC_*)
  storageBucket?: string;                        // default 'mailer-images'

  // ── auth ──
  auth: {
    secret: string;                      // AUTH_SECRET
    adminEmails: string;                 // resolved by env adapter (handles 4 allowlist names)
    cookieName: string;                  // 'es_session' | 'st_session' | 'orangish_io_session' | …
  };

  // ── email send ──
  resend: { apiKey: string; from: string; replyTo: string };

  // ── theme (§3) ──
  theme: ThemeTokens;
  emailTheme?: { brandColor: string; bgColor: string };  // defaults derived from theme.accent / a light bg

  // ── content ──
  starterBody?: string;                  // composer STARTER_BODY (default generic)
  welcomeDefaultBody?: string;           // welcome editor seed copy

  // ── per-feature options (§6) ──
  sports?: SportsConfig;                 // { values: string[]; namespace?: 'sport:'; defaultOnSignup?: string }
  timezone?: string;                     // Traffic 'today' bucket. default 'America/New_York'
  onSiteSource?: string;                 // conversion-source filter. default 'homepage'
  allowContactAsPhone?: boolean;         // /api/subscribe accepts phone-or-email. default false
  leads?: { enabled: boolean; table?: string; interestOptions?: string[] };  // default { enabled:false }
  postSource?: PostSource | null;        // Sanity/blog adapter. default null (button hidden)
  nav?: { extraTabs?: Array<{ key: string; label: string; href: string }> };  // roadmap/summer26 etc.
  publicSignupRoute?: '/api/subscribe' | '/api/waitlist';  // route name divergence. default '/api/subscribe'
}

export interface SportsConfig { values: string[]; namespace?: string; defaultOnSignup?: string }
```

### Env adapter — divergent names WITHOUT Vercel renames

```ts
// mailer-admin/src/config/env-adapter.ts
// Reads whichever names already exist in Vercel. No renames required.
export function resolveSupabaseEnv(): { url: string; key: string } {
  const url = process.env.MAILER_SUPABASE_URL        // orangish-io
           ?? process.env.NEXT_PUBLIC_SUPABASE_URL;  // everyone else
  const key = process.env.MAILER_SUPABASE_SERVICE_ROLE_KEY
           ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Mailer Supabase env not configured');
  return { url, key };
}

export function resolveAdminEmails(): string {
  // First non-empty of the 4 known names. Order: brand-specific → generic.
  return process.env.EXTONSPORTS_ADMIN_EMAILS
      ?? process.env.SQUASHTIGERS_ADMIN_EMAILS
      ?? process.env.PEAC_ADMIN_EMAILS
      ?? process.env.STARSQUASH_ADMIN_EMAILS
      ?? process.env.ADMIN_EMAILS          // excelcricket, smashshuttler, orangish-io
      ?? '';
}
```

> **MAILER_* precedence is critical for orangish-io**: it has BOTH `MAILER_SUPABASE_*` (mailers DB) *and* `SUPABASE_SERVICE_ROLE_KEY` (member-app DB) in Vercel. The adapter must prefer `MAILER_*` so the package never accidentally points at the member-app DB. The member-app client stays site-local (`lib/supabase-server.ts`).

Each site's config simply wires these in (example, extonsports):

```ts
// extonsports-v1/mailer-admin.config.ts
import { defineMailerConfig } from '@orangish/mailer-admin';
import { resolveSupabaseEnv, resolveAdminEmails } from '@orangish/mailer-admin/env';

export const cfg = defineMailerConfig({
  property: process.env.SITE_PROPERTY || 'extonsports',  // default stays in SITE config, not package
  brandName: 'Exton Sports Center',
  brandLabel: 'Exton Sports · Admin',
  orgAddress: '4 Tabas Lane, Building 2, Exton, PA 19341',
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://extonsports.com',
  contactEmail: 'info@extonsports.com',
  notify: { enabled: true, to: 'info@extonsports.com' },
  supabase: resolveSupabaseEnv(),
  auth: { secret: process.env.AUTH_SECRET!, adminEmails: resolveAdminEmails(), cookieName: 'es_session' },
  resend: { apiKey: process.env.RESEND_API_KEY!, from: process.env.RESEND_FROM || 'Exton Sports <noreply@orangish.io>', replyTo: 'info@extonsports.com' },
  theme: EXTONSPORTS_THEME,            // §3
  sports: { values: ['cricket','squash','badminton','turf','fitness'], namespace: 'sport:', defaultOnSignup: undefined },
  publicSignupRoute: '/api/waitlist',  // extonsports uses /api/waitlist not /api/subscribe
});
```

---

## 3. THE THEME CONTRACT

`ThemeTokens` — a flat token object. `ThemeProvider` emits each as a `--mt-*` CSS var; components use `var(--mt-accent)` etc. Email shell + markdown receive `theme.accent`/`emailTheme` directly as strings.

```ts
export interface ThemeTokens {
  accent: string; accentText: string;       // button bg + text-on-accent
  pageBg: string; panelBg: string;
  primaryText: string; mutedText: string; secondaryText: string;
  border: string; borderSoft: string;
  navBg: string; navActiveBg: string; navActiveText: string; navIdleText: string;
  tableHeadBg: string; tableHoverBg: string; barTrack: string;
  accentTintBg: string; chipText: string;
  okBg: string; okText: string; errBg: string; errText: string;
  fontFamily: string;
}
```

| token | extonsports | excelcricket | smashshuttler | peac | orangish-io | squashtigers | starsquash (new) |
|---|---|---|---|---|---|---|---|
| accent | `#F37A4A` | `#F37A4A` | `#F37A4A` | `#D4A843` | `#e0845a` | `#FF6520` | `#1E5BFF` |
| accentText | `#0D0D0D` | `#0D0D0D` | `#0D0D0D` | `#0D0D0D` | `#050505` | `#0D0D0D` | `#FFFFFF` |
| pageBg | `#FDF4EE` | `#FDF4EE` | `#FDF4EE` | `#FFFFFF` | `#050505` | `#FDF4EE` | `#0A0E1A` |
| panelBg | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#0F0F10` | `#FFFFFF` | `#11162A` |
| primaryText | `#0D0D0D` | `#0D0D0D` | `#0D0D0D` | `#0D0D0D` | `#FAFAFA` | `#0D0D0D` | `#FFFFFF` |
| mutedText | `#888888` | `#888888` | `#888888` | `#888888` | `#6E6E76` | `#888888` | `#6B7488` |
| secondaryText | `#666666` | `#666666` | `#666666` | `#666666` | `#A1A1A8` | `#666666` | `#A8B0C0` |
| border | `#E8D5C8` | `#E8D5C8` | `#E8D5C8` | `#E5E7EB` | `#1F1F22` | `#E8D5C8` | `rgba(255,255,255,.10)` |
| borderSoft | `#F4E8DD` | `#F4E8DD` | `#F4E8DD` | `#E5E7EB` | `#2A2A2E` | `#FBF3EC` | `rgba(255,255,255,.06)` |
| navBg | `#0D0D0D`* | `#0D0D0D`* | `#0D0D0D`* | `#0D0D0D` | `#000000` | `#0D0D0D`* | `#11162A` |
| navActiveBg | `#F37A4A` | `#F37A4A` | `#F37A4A` | `#D4A843` | `#e0845a` | `#FF6520` | `#1E5BFF` |
| navActiveText | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#0D0D0D` | `#050505` | `#FFFFFF` | `#FFFFFF` |
| navIdleText | `#FFFFFF`/dim | dim | dim | `#888` | `#A1A1A8` | dim | `#A8B0C0` |
| tableHeadBg | `#FBF3EC` | `#FBF3EC` | `#FBF3EC` | `#F7F7F7` | `#141416` | `#FBF3EC` | `#0A0E1A` |
| tableHoverBg | `#FCF6F1` | `#FCF6F1` | `#FCF6F1` | `#FAFAFA` | `#141416` | `#FCF6F1` | `#11162A` |
| barTrack | `#F3E7DD` | `#F3E7DD` | `#F3E7DD` | `#F3E7DD`→`#E5E7EB`† | `#1F1F22` | `#F3E7DD` | `rgba(255,255,255,.08)` |
| accentTintBg | `rgba(243,122,74,.12)` | `rgba(243,122,74,.12)` | `rgba(243,122,74,.12)` | `rgba(212,168,67,.12)` | `rgba(224,132,90,.12)` | `rgba(255,101,32,.12)` | `rgba(30,91,255,.14)` |
| chipText | `#9A5B3B` | `#9A5B3B` | `#9A5B3B` | `#9A5B3B`→accent† | `#A1A1A8` | `#9A5B3B` | `#A8B0C0` |
| okBg / okText | `#DCFCE7`/`#166534` | same | same | same | `#C7F94B`bg-ish | same | `#DCFCE7`/`#166534` |
| errBg / errText | `#FEE2E2`/`#991B1B` | same | same | same | `#F87171` | same | same |
| fontFamily | `'Familjen Grotesk', Arial, sans-serif` | same | same | dark-ink sans | `var(--font-sans)` | `'Familjen Grotesk'` | `'Space Grotesk', sans` |

\* The four salmon sites currently use a light/cream nav header in some places and dark in others; the package standardizes a dark `navBg` with accent active-pills (matches peac/orangish/squashtigers; extonsports nav becomes dark — acceptable cosmetic shift, called out in §7).
† peac's "leftover salmon" tokens (`#F4E8DD`, `#9A5B3B`, `rgba(243,122,74,.12)`, and the entire `/unsubscribe` cream theme) are copy-paste bleed — **map them to peac's real gold/gray tokens** during adoption (don't preserve the salmon).

`emailTheme` default = `{ brandColor: theme.accent, bgColor: '#FDF4EE' }` for light brands; orangish-io overrides `bgColor:'#FAF6F2'`, brandColor `#e0845a`. Email shells are **always light** (email clients) regardless of a dark admin theme — so orangish-io/starsquash set `emailTheme` explicitly rather than inheriting the dark `pageBg`.

---

## 4. CANONICAL SOURCE PER FEATURE

| Feature | Extract from | Why |
|---|---|---|
| **Subscribers table + DetailPanel** (cols, per-column sort, row-expand, inline edit, per-filter counts, restyle) | **squashtigers-v2** `SubscribersClient.tsx` | Newest/richest; all others are the legacy narrow variant |
| **Subscribers server page SELECT** (wide column list) | **squashtigers-v2** `subscribers/page.tsx` (verified) | Others select the narrow set; widen everyone |
| **CSV import (Wix-aware)** — header aliases, `import_metadata` jsonb, unsub carry-over + suppression, chunked existence check, Wix date parse | **squashtigers-v2** `import/route.ts` (verified) | Only canonical copy; others lack phone/city/country + metadata |
| **PATCH `[id]`** (flip + inline email/name edit, 409 on dupe) | **squashtigers-v2** `[id]/route.ts` | Richest; others only flip. **Add property scope to the UPDATE filter** (all sites currently filter by id only) |
| **Compose composer** (toolbar, image upload, YouTube/Vimeo, recipient picker, live preview, test/confirm) | **squashtigers-v2** `ComposeClient.tsx` minus Sanity | 650-line richest; strip the Sanity blog picker behind `cfg.postSource` |
| **Compose send / test-send / welcome routes** | **any** (`shared-identical` across all) — use **extonsports** as the literal source | Identical logic; just parameterize recipients re-fetch + audit row |
| **Traffic / Visits dashboard** (bar cards, conversion-by-source/region, ET 'today') | **squashtigers-v2** `visits/page.tsx` | Has the sport card + conversion tables; `timezone`/`onSiteSource` become config |
| **Welcome editor + route** | **any** (shared) — **extonsports** source; `DEFAULT_BODY` → `cfg.welcomeDefaultBody` | Logic identical; copy is config |
| **Magic-link / verify / logout / auth-guard** | **extonsports** `lib/auth.ts` + `auth-guard.ts` (verified shape) | Cleanest; cookie name + allowlist + secret become `cfg.auth.*` |
| **supabase REST wrapper** | **squashtigers** `lib/supabase.ts` (verified identical to orangish-io's) | Wrap in `createSupabase(cfg)` reading `cfg.supabase` |
| **send-mailer / email-template / markdown** | **extonsports** (List-Unsubscribe headers + sendOne) | Thread `cfg` for FROM/REPLY_TO/brand/accent |
| **sports helper** | **extonsports** `lib/sports.ts` (full multi-sport) | squashtigers' is a 1-value subset; make `SPORTS` come from `cfg.sports.values` |
| **rate-limit** | **orangish-io** `lib/rate-limit.ts` | Only site with it; promote to package |
| **`/api/unsubscribe` + `/unsubscribe` page** | **orangish-io** `api/unsubscribe/route.ts` (RFC-8058 GET+POST) + extonsports `unsubscribe/page.tsx` | Canonical handler; **squashtigers & excelcricket are MISSING the handler entirely** — package fixes this |
| **`/api/resubscribe`** | **orangish-io/peac/extonsports** (exists) | Missing in excelcricket & smashshuttler (their `ResubscribeForm` 404s) — package fixes |
| **Public subscribe/track** | **orangish-io** subscribe (honeypot + rate-limit) merged with **smashshuttler** contact-or-phone behind `cfg.allowContactAsPhone` | Most-hardened base + opt-in phone capture |

---

## 5. PER-SITE ADOPTION CHECKLIST

Common pattern for every adopting site:
- **Delete** all extracted files (listed below per site).
- **Add** `mailer-admin.config.ts` (root) + thin wrappers. Each admin route becomes:
  ```ts
  // app/api/admin/subscribers/route.ts
  import { createSubscribersRoute } from '@orangish/mailer-admin/routes';
  import { cfg } from '../../../../mailer-admin.config';
  export const { GET, POST } = createSubscribersRoute(cfg);
  export const dynamic = 'force-dynamic';
  ```
  Each admin page becomes:
  ```ts
  // app/admin/subscribers/page.tsx
  import { createSubscribersPage } from '@orangish/mailer-admin/pages';
  import { cfg } from '../../../mailer-admin.config';
  export default createSubscribersPage(cfg);
  export const dynamic = 'force-dynamic';
  ```
- **`next.config.ts`**: add `transpilePackages: ['@orangish/mailer-admin']` (merge with existing rewrites — do NOT drop the static-homepage rewrite where present).
- **`package.json`**: add `"@orangish/mailer-admin": "github:aniketkhera/mailer-admin#<pinned-sha>"`; remove now-unused `resend` only if not used elsewhere (keep it — peerDep).
- **Env**: no renames. Confirm `SITE_PROPERTY`, `AUTH_SECRET`, the existing allowlist var, `RESEND_*` are set. Run the canonical `migrate` once if a site's shared-DB columns lag (none needed — shared DB already has phone/city/country/import_metadata; verified squashtigers writes them).

### extonsports-v1 (PILOT)
- **Delete**: all 35 admin/lib/api files in the map EXCEPT `app/components/WaitlistSection.tsx` (public homepage form — **keep, site-local**) and `app/components/TrackBeacon.tsx` (keep or swap to package `NewsletterForm`/beacon — optional). Specifically delete `app/admin/**`, `app/api/admin/**`, `app/api/auth/**`, `app/api/{waitlist→ replace with package subscribe},track,resubscribe`, `app/unsubscribe/**`, `lib/{supabase,auth,auth-guard,send-mailer,email-template,markdown,sports}.ts`.
- **Add wrappers**: one per route/page (above). `publicSignupRoute: '/api/waitlist'` so the existing homepage form keeps POSTing to `/api/waitlist` (wrap `createSubscribeRoute(cfg)` and export it at `app/api/waitlist/route.ts`).
- **Config**: theme = `EXTONSPORTS_THEME` (col 1 of §3), `cookieName:'es_session'`, `adminEmails` via adapter (resolves `EXTONSPORTS_ADMIN_EMAILS`), `sports.values=['cricket','squash','badminton','turf','fitness']`, `notify:{enabled:true,to:'info@extonsports.com'}`.
- **Gain**: phone/city/country cols, import_metadata, sort, row-expand, inline edit, per-filter counts, Wix import, real `/unsubscribe`. **Keep**: sport segment (now a config option).

### excelcricket-v1
- **Delete**: all admin/lib/api/unsubscribe files in map; **drop dead `app/components/TrackBeacon.tsx`** (unused). Keep `public/index.html` (static homepage, site-local).
- **Add**: wrappers; `app/api/subscribe/route.ts` = `createSubscribeRoute(cfg)`; **NEW** `app/api/resubscribe/route.ts` = `createResubscribeRoute(cfg)` (fixes the 404 its `ResubscribeForm` hits); **NEW** `/unsubscribe` page+handler.
- **Config**: salmon theme (identical to extonsports cols), `cookieName:'es_session'`, `adminEmails` adapter → `ADMIN_EMAILS`, `sports:{values:[]}` (off — no sport UI), `notify:{enabled:true,to:'info@excelcricket.com'}`, `publicSignupRoute:'/api/subscribe'`.

### smashshuttler-v1
- **Delete**: all admin/lib/api files; **drop orphaned `TrackBeacon.tsx`** and the broken `ResubscribeForm` (replaced by package). Keep `public/index.html` (static, site-local, salmon `#F5A07B` public accent stays local).
- **Add**: wrappers; `app/api/subscribe/route.ts` with `allowContactAsPhone:true` (preserves email-OR-phone capture); **NEW** `/api/resubscribe` (fixes its 404); **NEW** `/unsubscribe`.
- **Config**: salmon theme, `cookieName:'es_session'`, `adminEmails`→`ADMIN_EMAILS`, fix the wrong `orgAddress` (currently Exton copy-paste — set real SmashShuttler address or leave generic), `notify:{enabled:true,to:'info@smashshuttler.com'}`, `allowContactAsPhone:true`.

### peac-v1
- **Delete**: all mailer admin/lib/api files; **keep site-local**: `app/api/lead/route.ts`, `app/components/LeadForm.tsx` — OR fold into package via `leads:{enabled:true,table:'leads',interestOptions:[...]}` and delete them (recommended: keep LeadForm as the homepage UI, but route it through `createLeadRoute(cfg)`).
- **Config**: **GOLD theme** (col 4 §3) — map the leftover salmon tokens to gold/gray; `cookieName:'es_session'`, `adminEmails` adapter → `PEAC_ADMIN_EMAILS`, `sports:{values:[]}` (vestigial — disable; dropdown/card auto-hide on empty), `starterBody` = PEAC fitness copy (replace the multi-sport STARTER_BODY), `welcomeDefaultBody` = PEAC copy, `leads:{enabled:true, interestOptions:['General fitness','Sports performance','Functional fitness','Youth training']}`, `timezone:'America/New_York'`.
- **Fix while extracting**: the `/unsubscribe` page must use gold tokens, not the salmon literals.

### orangish-io (SECOND-DB SITE — special)
- **Delete**: mailer-only files — `lib/mailer-supabase.ts`, `lib/{auth,auth-guard,send-mailer,email-template,markdown,rate-limit}.ts`, all `app/api/{admin,auth,subscribe,unsubscribe,resubscribe,track}/**`, mailer `app/admin/{page,login,subscribers,compose,welcome,sends,visits}/**`, `app/components/{NewsletterSignup,TrackBeacon}.tsx`.
- **KEEP site-local (NOT in package)**: `lib/supabase-server.ts` (member-app DB), `lib/roadmap`, `app/admin/roadmap/**`, `app/admin/roadmap-longterm/**`, `app/api/features/**`. These share the package's magic-link login + AdminNav but talk to the *other* DB.
- **Config**:
  - `supabase: resolveSupabaseEnv()` → resolves **`MAILER_SUPABASE_URL`/`MAILER_SUPABASE_SERVICE_ROLE_KEY`** (precedence ensures it does NOT grab the member-app key). **This is the load-bearing reason the adapter prefers `MAILER_*`.**
  - `cookieName:'orangish_io_session'` (preserve — avoids collision; same cookie shared with roadmap pages).
  - `adminEmails` adapter → `ADMIN_EMAILS`.
  - **Dark theme** (col 5 §3): admin already uses `var(--color-*)`; map those to `--mt-*` via `ThemeProvider`, OR set `theme` literals from globals. `emailTheme:{brandColor:'#e0845a',bgColor:'#FAF6F2'}` (email stays light).
  - `notify:{enabled:true,to:'akhera@gmail.com'}` (de-hardcode the inlined recipient).
  - `sports:{values:['squash'],defaultOnSignup:'squash'}` (preserve inline default).
  - **`nav.extraTabs`**: `[{key:'roadmap',label:'Roadmap',href:'/admin/roadmap'},{key:'roadmap-longterm',label:'Long-term',href:'/admin/roadmap-longterm'}]` — package nav renders standard tabs + these two. The roadmap pages import the package `AdminNav` with `active="roadmap"`.
- **Member-app client untouched**: `lib/supabase-server.ts` keeps `@supabase/supabase-js` and reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. Two clients coexist; the package only ever uses the `MAILER_*` one.

### squashtigers-v2 (CONVERGE — it's the canonical source)
- **Delete**: same admin/lib/api set, **after** the package has extracted from it. Keep site-local: `app/admin/summer2026/**` + `playbook-content.ts`, `lib/sanity` + `lib/portable-text`, `app/api/admin/compose/post/route.ts` (Sanity), `public/squashtigers.html` (static homepage), `app/components/NewsletterBanner.tsx` (dormant — replace with package `NewsletterForm` if re-mounting, else delete).
- **Config**: theme col 6 (`accent:#FF6520`), `cookieName:'st_session'`, `adminEmails`→`SQUASHTIGERS_ADMIN_EMAILS`, `sports:{values:['squash']}`, `timezone:'America/New_York'`, `orgAddress:'Plainsboro, NJ · Exton, PA · West Hartford, CT'`, `welcomeDefaultBody` = NJ/PA/CT copy, **`postSource`** = site-local Sanity adapter implementing `PostSource` (so the "Send a blog post" picker keeps working):
  ```ts
  postSource: createSanityPostSource({ projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!, dataset: process.env.NEXT_PUBLIC_SANITY_DATASET! })
  ```
  - `nav.extraTabs`: `[{key:'summer2026',label:'Summer 26',href:'/admin/summer2026'}]`.
- **Fix it gains**: a real `/unsubscribe` page+handler (currently missing in this repo though emails link to it — **package closes this live gap**).

### starsquash-v1 (FROM SCRATCH — adopt everything)
- **Nothing to delete** (no admin exists). Decide leads vs subscribers model:
  - **Recommended**: keep `starsquash_leads` + `app/api/lead/route.ts` + `LeadForm.tsx` as the sales-lead path (site-local, unchanged), AND adopt the full package for a *separate* mailing-list signup. Set `leads:{enabled:true,table:'starsquash_leads',interestOptions:[...]}` if you want leads surfaced in admin too.
- **Add (all new)**:
  - `mailer-admin.config.ts` with `property:'starsquash'`, dark cobalt theme (col 7), `cookieName:'ss_session'`, `adminEmails` adapter → **new `STARSQUASH_ADMIN_EMAILS`**, `resend:{from:'Star Squash <leads@starsquash.com>',replyTo:'contact@starsquash.com'}`, `emailTheme:{brandColor:'#1E5BFF',bgColor:'#F5F4EF'}`.
  - All admin pages + routes as thin wrappers.
  - **A public signup**: mount package `NewsletterForm` (themeable) on the homepage → `createSubscribeRoute(cfg)` at `app/api/subscribe`.
  - **`/unsubscribe` + `/api/resubscribe`** (package-provided).
  - **New env in Vercel**: `SITE_PROPERTY=starsquash`, `STARSQUASH_ADMIN_EMAILS`, `AUTH_SECRET`. Repoint `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` at the **shared Mailers project** (or, if leads stay on a site-local DB, give the Mailers project its own `MAILER_SUPABASE_*` pair and let the adapter pick those — cleanest, mirrors orangish-io).

---

## 6. UNIQUE-FEATURE HANDLING

| Feature | Site(s) | Decision | How |
|---|---|---|---|
| Sport-interest segmentation (`sport:` tags, Add/Import dropdown, recipient filter, "Signups by sport" card, derive-from-`?sport=`/UTM) | extonsports, peac, squashtigers, orangish-io | **PACKAGE OPTION** (default OFF) | `cfg.sports={values:[]}` hides all sport UI (components conditionally render only when `values.length>0`). extonsports passes 5 values, squashtigers `['squash']`, orangish-io `['squash']`+default, peac `[]`. **Do not lose extonsports' segment.** |
| Public route name `/api/waitlist` vs `/api/subscribe` | extonsports & peac (`/api/waitlist`); others `/api/subscribe` | **PACKAGE OPTION** | `cfg.publicSignupRoute`; site exports the same `createSubscribeRoute(cfg)` at whichever path file it keeps |
| New-signup admin notification email | all subscribe routes (hardcoded recipients incl. `akhera@gmail.com`) | **PACKAGE OPTION** (default off) | `cfg.notify={enabled,to}`; de-hardcode orangish-io's inlined `akhera@gmail.com` |
| Email-OR-phone public capture (`contact` field, `phone`/`zip:` tags) | smashshuttler | **PACKAGE OPTION** | `cfg.allowContactAsPhone` |
| ET-calendar 'today' + `source='homepage'` conversion filter | all visits dashboards | **PACKAGE OPTION** | `cfg.timezone` (default `America/New_York`), `cfg.onSiteSource` (default `homepage`) |
| Welcome-email auto-send | all (canonical feature) | **PACKAGE BASELINE** | always present; `welcome_emails` already property-scoped |
| YouTube **+ Vimeo** embed in markdown | all markdown.ts | **PACKAGE BASELINE** (brand-agnostic) | keep both |
| Sanity blog-post import in composer (`/api/admin/compose/post`, PortableText→MD) | squashtigers | **PACKAGE OPTION via adapter** | `cfg.postSource: PostSource|null`; Sanity impl + `next-sanity` stay **site-local**. Button hidden when null → no other site pulls Sanity |
| Leads table + `/api/lead` + interest options | peac, starsquash | **PACKAGE OPTION** | `cfg.leads={enabled,table,interestOptions}`; `createLeadRoute(cfg)`. The PEAC/StarSquash interest lists are site config |
| Roadmap / Long-term feature-voting (member-app DB) | orangish-io | **KEEP SITE-LOCAL** | not mailer; only shares AdminNav (via `cfg.nav.extraTabs`) + login. `lib/supabase-server.ts` untouched |
| Summer-2026 GTM playbook page | squashtigers | **KEEP SITE-LOCAL** | internal doc; injected as `nav.extraTabs` entry, content stays in repo |
| Formsubmit.co fallback when no Resend key | starsquash | **KEEP SITE-LOCAL** | lead-only zero-setup path; not a mailing concern |
| `WaitlistSection`/`NewsletterBanner`/`NewsletterSignup`/`LeadForm` public homepage forms | extonsports, squashtigers, orangish-io, peac | **KEEP SITE-LOCAL** (Tailwind-themed to public site) | package provides an OPTIONAL generic `NewsletterForm` for starsquash/dormant sites; existing branded forms stay |
| Orphaned/dead `TrackBeacon.tsx` | excelcricket, smashshuttler | **DROP** | unused; static HTML inlines its own beacon |
| Broken `ResubscribeForm`→missing `/api/resubscribe` | excelcricket, smashshuttler, (squashtigers missing `/unsubscribe`) | **DROP local, FIX in package** | package ships real `/api/resubscribe` + `/unsubscribe` |
| Three duplicated email preview shells (Compose, Welcome, email-template) | all | **CONSOLIDATE** | one `renderEmailHtml(cfg, …)`; client previews call it (or a `/api/admin/preview` echo) instead of inlining |
| `import_metadata` jsonb / phone/city/country / sort / expand / inline-edit / per-filter counts | squashtigers only | **PACKAGE BASELINE** | canonical; all sites gain it (no migration — shared DB has the columns) |

---

## 7. SEQUENCING + RISK

**Safe order**

1. **Build the package** by extracting from the canonical sources (§4), driving everything off `cfg`. Internally validate with a throwaway `examples/extonsports` app (copy extonsports env) that `next build` is clean. No site touched yet.
2. **Pilot = extonsports-v1** (richest unique surface: sport segment + `/api/waitlist` + notify). Branch, swap to wrappers, deploy to a Vercel **preview**. Verify end-to-end: magic-link login, subscribers (Wix import on a sample CSV, sort/expand/inline-edit), compose test-send + real send to a seed list, welcome toggle, traffic dashboard, public `/api/waitlist` signup, `/unsubscribe` + resubscribe. Compare a sent email byte-for-byte against current prod. Merge only after parity.
3. **Roll out the three twins** (excelcricket, smashshuttler — and peac) in parallel; they're the same salmon/gold shape with config deltas (allowlist env, sports off, leads for peac, phone for smashshuttler). Each: preview → verify login + one send + signup + unsubscribe → merge.
4. **Converge squashtigers-v2** last among existing sites — it's the canonical donor, so do it after the package is proven to avoid editing the source-of-truth mid-extraction. Wire the Sanity `postSource` adapter + `summer2026` nav tab; verify the blog-import picker still works and that the **newly-added `/unsubscribe`** resolves (closes the live gap).
5. **orangish-io** alongside/after squashtigers — needs the dual-DB care (adapter `MAILER_*` precedence, keep roadmap local, `nav.extraTabs`). Verify the roadmap tabs + member-app DB are untouched and the mailer admin reads the Mailers DB.
6. **starsquash-v1** last — from-scratch adopt: new env, public form, unsubscribe, decide leads-vs-subscribers.

**Top risks & mitigations**

| Risk | Impact | Mitigation |
|---|---|---|
| **orangish-io wrong-DB**: adapter grabs `SUPABASE_SERVICE_ROLE_KEY` (member-app) instead of `MAILER_*` | Mailer admin reads/writes the member-app DB — data corruption | Adapter **prefers `MAILER_*`**; add a startup assertion in `createSupabase` that logs the resolved host; verify on preview before merge |
| **Email rendering drift** (consolidating 3 shells into one) | Live emails change appearance / break clients | Snapshot current prod email HTML per brand; diff package `renderEmailHtml` output against it during pilot; `emailTheme` per brand keeps colors exact |
| **Theme regression on dark sites** (orangish-io/starsquash) using a shell built/tested on light salmon | Unreadable admin or broken contrast | `ThemeProvider` + `--mt-*` everywhere (no literal hex left in components); test orangish-io explicitly in pilot phase, not just at rollout |
| **Cookie-name collision / forced logout** if package defaults a cookie name | All admins logged out, or cross-site cookie bleed on shared domains | `cfg.auth.cookieName` is **required, no default**; preserve each site's existing name (`es_/st_/orangish_io_session`) so live sessions survive |
| **Missing `/unsubscribe` becomes a hard 404 at scale** (squashtigers/excelcricket relied on absent routes) | CAN-SPAM violation if a send goes out with a dead unsubscribe link | Package ships `/unsubscribe` page + `/api/unsubscribe` as baseline; verify the footer link resolves on every site's preview before any send |
| **`AGENTS.md` warning: "this is NOT the Next.js you know"** (Next 16.2.6 breaking changes) | Factory-returned route handlers / async server components may not match training-data conventions | Read `node_modules/next/dist/docs/` before writing route/page factories; validate `export const { GET, POST } = factory(cfg)` is a supported route-handler shape in 16.2.6 |
| **Sport UI leaks to brands that disabled it** | peac/excelcricket show stray sport dropdowns | Components gate on `cfg.sports.values.length>0`; default `sports` unset → empty → hidden |
| **PATCH `[id]` cross-property write** (all sites filter by id only today) | A shared-table id collision edits another property's row | Package PATCH adds `property: eq.${cfg.property}` to the UPDATE filter (squashtigers' inline-edit route already the donor; just add scope) |
| **Git-dependency version skew** (sites pin different SHAs) | Drift returns — the thing we're trying to kill | Pin all consumers to the **same tag**; bump in lockstep; CI check that flags mismatched `mailer-admin` SHAs across the 7 repos |
| **Static-homepage rewrites dropped** when editing `next.config.ts` (excelcricket/smashshuttler/squashtigers serve `public/*.html` via rewrite) | Homepage 404 | Treat `next.config.ts` edits as merge-not-replace; only ADD `transpilePackages`, never touch existing `rewrites` |

Relevant absolute paths for the implementation: canonical donors at `C:/Users/rkher/squashtigers-v2/app/admin/subscribers/SubscribersClient.tsx`, `C:/Users/rkher/squashtigers-v2/app/api/admin/subscribers/import/route.ts`, `C:/Users/rkher/squashtigers-v2/app/admin/compose/ComposeClient.tsx`, `C:/Users/rkher/squashtigers-v2/app/admin/visits/page.tsx`; auth/supabase/send donors at `C:/Users/rkher/extonsports-v1/lib/{auth,auth-guard,send-mailer,email-template,markdown,sports}.ts` and `C:/Users/rkher/squashtigers-v2/lib/supabase.ts`; RFC-8058 unsubscribe + rate-limit donors at `C:/Users/rkher/orangish-io/app/api/unsubscribe/route.ts` and `C:/Users/rkher/orangish-io/lib/rate-limit.ts`; orangish-io dual-DB reference at `C:/Users/rkher/orangish-io/lib/mailer-supabase.ts` (Mailers) vs `C:/Users/rkher/orangish-io/lib/supabase-server.ts` (member-app, stays local).

---
---

# CRITIC CORRECTIONS — MUST APPLY (from the adversarial review)

These override the blueprint above wherever they conflict.

## Blocking (fix before/while building)
1. **Supabase wrapper = LAZY env, canonical donor = orangish-io** (NOT squashtigers). Resolve `cfg.supabase()` -> {url,key} INSIDE each REST call. Expose `configured()`. Never throw at import (warn only) so env-incomplete previews/pilots still build + render a "not configured" state.
2. **renderEmailHtml(cfg, { subject, bodyHtml, unsubscribeUrl })** — KEEP `subject` (drives <title>/preheader). One function for BOTH preview and send. Byte-diff vs current prod sent-HTML per brand during the extonsports pilot (gate).
3. **markdownToEmailHtml(md, { linkColor })** — convert each donor"s module-level STYLES const into a factory threading `linkColor = cfg.theme.accent`. DELETE every local markdown.ts on adoption; route ALL markdown (preview + send + welcome + subscribe) through the package fn.

## Should-fix (silent loss / breakage)
4. **createAuth(cfg)** — secret/adminEmails/cookieName via cfg; ZERO top-level `process.env` reads (enforce by grep gate over package src). Crypto must stay byte-compatible with the donor so existing signed sessions validate. Preserve each site"s cookie name EXACTLY: extonsports `es_session`, orangish-io `orangish_io_session`, squashtigers `st_session` (others: read from disk before migrating).
5. **Env adapter precedence (load-bearing):** supabase = `MAILER_SUPABASE_URL/KEY` ?? `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. allowlist = `MAILER_ADMIN_EMAILS` ?? `<PROPERTY>_ADMIN_EMAILS` ?? `ADMIN_EMAILS`. createSupabase logs resolved host; on orangish-io FAIL-CLOSED if host == member-app project ref. Leave orangish `lib/supabase-server.ts` untouched + site-local.
6. **Unsubscribe = BOTH** a `/unsubscribe` PAGE (footer-link target humans click; renders + flips) AND an RFC-8058 GET+POST `/api/unsubscribe` route (one-click List-Unsubscribe-Post). squashtigers has NEITHER today (live CAN-SPAM gap) -> add on adoption. excel/smash flip inline-in-page today; keep `/unsubscribe?token=` resolving as a PAGE.
7. **peac leads interestOptions = {value,label}[]** seeded with existing CODES (general / sports_performance / functional_fitness / youth). LeadForm still posts `value`.
8. **Visits "today" bucket:** keep `toLocaleDateString("en-CA", { timeZone: cfg.timezone })` — the en-CA ISO format is the bucket key; `cfg.timezone` default America/New_York.
9. **next.config per site differs:** only ADD `transpilePackages:["mailer-admin"]`, never touch existing rewrites. extonsports has NO next.config (React homepage) -> CREATE one. squashtigers rewrites is a multi-entry array -> do not clobber.
10. **Validate `export const {GET,POST}=factory(cfg)` against Next 16.2.6 in the extonsports pilot BEFORE building all ~20 route factories.** Fallback: `export async function GET(req){ return f.GET(req) }` wrappers.

## Unique features -> PACKAGE OPTIONS (default off where brand-specific)
sport/segment list; leads {enabled,table,interestOptions}; email-or-phone contact capture (smashshuttler); welcome emails; YouTube/Vimeo embeds; Sanity blog adapter (squashtigers); admin-notify address (extonsports); timezone; config-driven AdminNav extraTabs; themed magic-link email.

## STAY SITE-LOCAL (never in package)
each site"s marketing homepage (static index.html or React); orangish roadmap/features + lib/supabase-server + /api/features; squashtigers /admin/summer2026; peac marketing subpages; starsquash starsquash_leads + formsubmit fallback.

## Canonical donors
supabase wrapper = orangish-io (lazy); subscribers admin + Wix import + schema extras = squashtigers; email shell / markdown / compose / send / welcome / traffic / auth = one donor + parameterize (mostly shared-identical).

## Sequencing
package core -> extonsports PILOT (validate route shape + email byte-diff) -> excelcricket + smashshuttler -> squashtigers + orangish-io -> starsquash LAST.
