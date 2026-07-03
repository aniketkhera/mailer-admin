// Email rendering + send pipeline, config-injected. Consolidates the
// canonical lib/markdown.ts + lib/email-template.ts + lib/send-mailer.ts.
// Brand name, physical address, colors, from/replyTo, and the link color
// all come from the site's MailerConfig — nothing hardcoded per brand.

import { Resend } from 'resend'
import type { MailerConfig } from '../config'

// ───────────────────────── Markdown → email-safe HTML ─────────────────────────
// Tiny Markdown compiler. Emits inline-styled fragment HTML (no <html>/
// <body>) wrapped by renderEmailHtml at send time. Only the link color is
// per-brand; the rest is neutral + email-client-safe (table-friendly).

const YOUTUBE_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&][^\s]*)?$/i
const VIMEO_RE   = /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)(?:\/[\w]+)?(?:\?[^\s]*)?$/i

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

const STYLES = {
  p:      'margin:0 0 18px 0;font-size:16px;line-height:1.65;color:#222;',
  h1:     'margin:32px 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:800;color:#0D0D0D;line-height:1.2;',
  h2:     'margin:28px 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:21px;font-weight:800;color:#0D0D0D;line-height:1.25;',
  h3:     'margin:24px 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#0D0D0D;line-height:1.3;',
  ul:     'margin:0 0 18px 0;padding:0 0 0 22px;font-size:16px;line-height:1.65;color:#222;',
  ol:     'margin:0 0 18px 0;padding:0 0 0 22px;font-size:16px;line-height:1.65;color:#222;',
  li:     'margin:0 0 6px 0;',
  hr:     'border:none;border-top:1px solid #E8D5C8;margin:28px 0;',
  imgWrap:'margin:18px 0;text-align:center;',
  img:    'max-width:100%;height:auto;border-radius:8px;display:inline-block;',
  videoCard:    'display:block;margin:18px 0;border:1px solid #E8D5C8;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;background:#FAFAFA;',
  videoThumb:   'display:block;width:100%;max-width:560px;height:auto;',
  videoCaption: 'padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#666;',
}

function renderInline(text: string, linkColor: string): string {
  let out = escapeHtml(text)
  out = out.replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, (_m, label, url) =>
    `<a href="${url}" style="color:${linkColor};text-decoration:underline;" target="_blank" rel="noopener">${label}</a>`)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  return out
}

function youtubeCard(videoId: string, originalUrl: string): string {
  const thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  const watch = `https://www.youtube.com/watch?v=${videoId}`
  return [
    `<a href="${watch}" target="_blank" rel="noopener" style="${STYLES.videoCard}">`,
    `<img src="${thumb}" alt="Watch on YouTube" style="${STYLES.videoThumb}" />`,
    `<div style="${STYLES.videoCaption}">▶  Watch on YouTube</div>`,
    `</a>`,
    `<!-- ${escapeHtml(originalUrl)} -->`,
  ].join('')
}

function vimeoCard(videoId: string, originalUrl: string): string {
  const watch = `https://vimeo.com/${videoId}`
  return [
    `<a href="${watch}" target="_blank" rel="noopener" style="${STYLES.videoCard}">`,
    `<div style="${STYLES.videoCaption}">▶  Watch on Vimeo — ${watch}</div>`,
    `</a>`,
    `<!-- ${escapeHtml(originalUrl)} -->`,
  ].join('')
}

export function markdownToEmailHtml(md: string, opts: { linkColor?: string } = {}): string {
  const linkColor = opts.linkColor || '#F37A4A'
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) { i++; continue }

    if (/^---+$/.test(trimmed)) { out.push(`<hr style="${STYLES.hr}" />`); i++; continue }

    let m: RegExpMatchArray | null
    if ((m = trimmed.match(/^(#{1,3})\s+(.+)$/))) {
      const level = m[1].length
      const tag = `h${level}` as 'h1' | 'h2' | 'h3'
      out.push(`<${tag} style="${STYLES[tag]}">${renderInline(m[2], linkColor)}</${tag}>`)
      i++; continue
    }

    if ((m = trimmed.match(/^!\[([^\]]*)\]\((https?:[^)\s]+)\)$/))) {
      const alt = escapeHtml(m[1])
      // Escape the src: the raw line is NOT pre-escaped here (unlike
      // renderInline), so an embedded quote would otherwise break out of the
      // src="" attribute and inject arbitrary attributes (e.g. onerror).
      const src = escapeHtml(m[2])
      out.push(`<div style="${STYLES.imgWrap}"><img src="${src}" alt="${alt}" style="${STYLES.img}" /></div>`)
      i++; continue
    }

    if ((m = trimmed.match(YOUTUBE_RE))) { out.push(youtubeCard(m[1], trimmed)); i++; continue }
    if ((m = trimmed.match(VIMEO_RE)))   { out.push(vimeoCard(m[1], trimmed));   i++; continue }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(`<li style="${STYLES.li}">${renderInline(lines[i].trim().replace(/^[-*]\s+/, ''), linkColor)}</li>`)
        i++
      }
      out.push(`<ul style="${STYLES.ul}">${items.join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(`<li style="${STYLES.li}">${renderInline(lines[i].trim().replace(/^\d+\.\s+/, ''), linkColor)}</li>`)
        i++
      }
      out.push(`<ol style="${STYLES.ol}">${items.join('')}</ol>`)
      continue
    }

    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|---+$|[-*]\s|\d+\.\s|!\[)/.test(lines[i].trim())) {
      if (YOUTUBE_RE.test(lines[i].trim()) || VIMEO_RE.test(lines[i].trim())) break
      para.push(lines[i])
      i++
    }
    out.push(`<p style="${STYLES.p}">${renderInline(para.join(' ').trim(), linkColor)}</p>`)
  }

  return out.join('\n')
}

// ───────────────────────── Email shell (CAN-SPAM compliant) ─────────────────────────

export type EmailShellArgs = {
  subject: string
  bodyHtml: string
  unsubscribeUrl: string
}

export function renderEmailHtml(cfg: MailerConfig, args: EmailShellArgs): string {
  const { subject, bodyHtml, unsubscribeUrl } = args
  const brand = cfg.brandName
  const bg = cfg.theme.pageBg
  const accent = cfg.theme.accent
  const address = cfg.email.physicalAddress
  const signupContext = cfg.email.signupContext || `you signed up at ${brand}`
  const contact = cfg.email.contactEmail
  const contactLink = contact
    ? `\n              &nbsp;&middot;&nbsp;\n              <a href="mailto:${contact}" style="color:#777;text-decoration:underline;">Contact us</a>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${bg};">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;">
    ${stripTags(bodyHtml).slice(0, 140)}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${bg};">
    <tr><td align="center" style="padding:24px 12px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E8D5C8;border-radius:14px;overflow:hidden;">

        <tr><td style="padding:24px 32px 12px 32px;border-bottom:1px solid #F4E8DD;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:${accent};">
            ${escapeHtml(brand)}
          </div>
        </td></tr>

        <tr><td style="padding:24px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;color:#222222;">
          ${bodyHtml}
        </td></tr>

        <tr><td style="padding:18px 32px 24px 32px;border-top:1px solid #F4E8DD;background:${bg};">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.65;color:#777777;">
            <p style="margin:0 0 8px 0;">
              <strong style="color:#444;">${escapeHtml(brand)}</strong><br />
              ${escapeHtml(address)}
            </p>
            <p style="margin:8px 0 0 0;">
              You&rsquo;re receiving this because ${escapeHtml(signupContext)}.<br />
              <a href="${unsubscribeUrl}" style="color:#777;text-decoration:underline;">Unsubscribe</a>${contactLink}
            </p>
          </div>
        </td></tr>

      </table>

    </td></tr>
  </table>
</body>
</html>`
}

// ───────────────────────── Send pipeline ─────────────────────────

const BATCH_SIZE = 100
const BATCH_DELAY_MS = 1100

export type Recipient = { email: string; unsubscribe_token: string }
export type SendArgs = { subject: string; bodyHtml: string; recipients: Recipient[] }
export type SendReport = {
  sent: number
  failed: number
  errors: Array<{ batchIndex: number; emails: string[]; message: string }>
}

/** Human-facing GET landing (the footer "Unsubscribe" link). */
export function unsubscribeUrl(cfg: MailerConfig, token: string): string {
  return `${cfg.appUrl.replace(/\/$/, '')}/unsubscribe?token=${encodeURIComponent(token)}`
}

/** RFC-8058 one-click POST endpoint (the List-Unsubscribe header target). */
export function unsubscribePostUrl(cfg: MailerConfig, token: string): string {
  return `${cfg.appUrl.replace(/\/$/, '')}/api/unsubscribe?token=${encodeURIComponent(token)}`
}

export async function sendMailer(cfg: MailerConfig, args: SendArgs): Promise<SendReport> {
  const key = cfg.resend.apiKey
  if (!key) throw new Error('RESEND_API_KEY is not set')

  const resend = new Resend(key)
  const report: SendReport = { sent: 0, failed: 0, errors: [] }

  for (let i = 0; i < args.recipients.length; i += BATCH_SIZE) {
    const batch = args.recipients.slice(i, i + BATCH_SIZE)
    const payload = batch.map(r => {
      const unsubUrl = unsubscribeUrl(cfg, r.unsubscribe_token)
      const postUrl = unsubscribePostUrl(cfg, r.unsubscribe_token)
      return {
        from: cfg.resend.from,
        to: r.email,
        ...(cfg.email.replyTo ? { replyTo: cfg.email.replyTo } : {}),
        subject: args.subject,
        html: renderEmailHtml(cfg, { subject: args.subject, bodyHtml: args.bodyHtml, unsubscribeUrl: unsubUrl }),
        headers: {
          // Human link in the footer points at the GET landing; the
          // List-Unsubscribe header points at the POST one-click endpoint.
          'List-Unsubscribe': `<${postUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }
    })

    try {
      const { error } = await resend.batch.send(payload)
      if (error) {
        report.failed += batch.length
        report.errors.push({ batchIndex: i / BATCH_SIZE, emails: batch.map(b => b.email), message: error.message || 'unknown Resend error' })
      } else {
        report.sent += batch.length
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network error'
      report.failed += batch.length
      report.errors.push({ batchIndex: i / BATCH_SIZE, emails: batch.map(b => b.email), message: msg })
    }

    if (i + BATCH_SIZE < args.recipients.length) {
      await new Promise(res => setTimeout(res, BATCH_DELAY_MS))
    }
  }

  return report
}

export async function sendOne(cfg: MailerConfig, args: { to: string; subject: string; html: string }): Promise<void> {
  const key = cfg.resend.apiKey
  if (!key) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(key)
  const { error } = await resend.emails.send({
    from: cfg.resend.from,
    to: args.to,
    ...(cfg.email.replyTo ? { replyTo: cfg.email.replyTo } : {}),
    subject: args.subject,
    html: args.html,
  })
  if (error) throw new Error(error.message || 'Resend send failed')
}
