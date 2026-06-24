'use client'

import { useState } from 'react'
import type { Theme } from '../../config'

export type MailerRow = {
  id: string
  subject: string
  body_md: string
  body_html: string
  sent_at: string
  sent_by_email: string
  recipient_count: number
  recipient_emails: string[]
  filter_json: Record<string, unknown> | null
  send_errors: unknown[] | null
}

export default function SendsClient({ rows, loadError, theme }: { rows: MailerRow[]; loadError: string | null; theme: Theme }) {
  const t = theme
  const [openId, setOpenId] = useState<string | null>(null)
  const open = openId ? rows.find(r => r.id === openId) : null

  // ── themed primitives (close over `t`) ───────────────────────────
  function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
    return <th style={{ padding: '10px 14px', textAlign: align, fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.mutedText }}>{children}</th>
  }
  function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
    return <td style={{ padding: '10px 14px', textAlign: align, color: t.mutedText, verticalAlign: 'top' }}>{children}</td>
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: t.text, margin: '0 0 6px 0' }}>
        Send history <span style={{ fontWeight: 600, color: t.mutedText, fontSize: 16 }}>({rows.length})</span>
      </h1>
      <p style={{ fontSize: 13, color: t.mutedText, margin: '0 0 22px 0' }}>
        Every mailer sent through the composer is logged here. Open counts + click counts live in your Resend dashboard.
      </p>

      {loadError && (
        <div style={{ padding: '10px 14px', borderRadius: 9, marginBottom: 14, fontSize: 13, background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B' }}>
          {loadError}
        </div>
      )}

      <div style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: t.headerBg, borderBottom: `1px solid ${t.border}` }}>
              <Th>Subject</Th>
              <Th>Sent</Th>
              <Th>By</Th>
              <Th align="right">Recipients</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '28px 16px', textAlign: 'center', color: t.mutedText }}>
                No mailers sent yet.
              </td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${t.borderSoft}` }}>
                <Td>
                  <div style={{ fontWeight: 600, color: t.text }}>{r.subject}</div>
                  {r.send_errors && Array.isArray(r.send_errors) && r.send_errors.length > 0 && (
                    <div style={{ fontSize: 11, color: '#991B1B', marginTop: 2 }}>
                      {r.send_errors.length} batch error{r.send_errors.length === 1 ? '' : 's'} — open for detail
                    </div>
                  )}
                </Td>
                <Td>{new Date(r.sent_at).toLocaleString()}</Td>
                <Td>{r.sent_by_email}</Td>
                <Td align="right"><strong>{r.recipient_count}</strong></Td>
                <Td align="right">
                  <button onClick={() => setOpenId(r.id)}
                    style={{ background: 'transparent', border: 'none', color: t.accent, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '4px 8px' }}>
                    Open →
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && <DetailModal row={open} onClose={() => setOpenId(null)} t={t} />}
    </div>
  )
}

function DetailModal({ row, onClose, t }: { row: MailerRow; onClose: () => void; t: Theme }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.panelBg, borderRadius: 14, padding: 24, maxWidth: 820, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px 0', color: t.text }}>{row.subject}</h2>
            <div style={{ fontSize: 12, color: t.mutedText }}>
              {new Date(row.sent_at).toLocaleString()} · by {row.sent_by_email} · {row.recipient_count} recipient{row.recipient_count === 1 ? '' : 's'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.mutedText, fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>

        {row.send_errors && Array.isArray(row.send_errors) && row.send_errors.length > 0 && (
          <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 9, fontSize: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Batch errors</div>
            <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(row.send_errors, null, 2)}
            </pre>
          </div>
        )}

        {row.recipient_emails && row.recipient_emails.length > 0 && (
          <div style={{ padding: '10px 14px', background: t.headerBg, borderRadius: 9, fontSize: 12, color: t.mutedText, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: t.text }}>
              Recipients ({row.recipient_emails.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {row.recipient_emails.map(email => (
                <span key={email} style={{ background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 9999, padding: '2px 10px', fontSize: 11 }}>
                  {email}
                </span>
              ))}
            </div>
          </div>
        )}

        {row.filter_json && Object.keys(row.filter_json).length > 0 && (
          <div style={{ padding: '8px 12px', background: t.headerBg, borderRadius: 8, fontSize: 11, color: t.mutedText, marginBottom: 14 }}>
            <strong>Filter used:</strong> {JSON.stringify(row.filter_json)}
          </div>
        )}

        <div style={{ flex: 1, border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden', minHeight: 0 }}>
          <iframe
            srcDoc={row.body_html}
            sandbox="allow-popups"
            style={{ width: '100%', height: '100%', minHeight: 360, border: 'none', background: t.pageBg }}
            title={row.subject}
          />
        </div>
      </div>
    </div>
  )
}
