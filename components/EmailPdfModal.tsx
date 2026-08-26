'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { X, Send, Loader2, Check, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Props = {
  onClose: () => void
  defaultRecipients: string[]
  defaultSubject: string
  defaultBody: string
  buildAttachment: () => Promise<{ filename: string; base64: string }>
  // Who this letter is about, so the send gets logged to their Communications
  // history — lets you check later whether it was actually sent.
  logContext?: { studentId?: string; donorId?: string }
}

type EmailAccountOption = { id: string; label: string; email: string; is_default: boolean }

export default function EmailPdfModal({ onClose, defaultRecipients, defaultSubject, defaultBody, buildAttachment, logContext }: Props) {
  const supabase = createClient()
  const [to, setTo] = useState(defaultRecipients.join(', '))
  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody] = useState(defaultBody)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [accounts, setAccounts] = useState<EmailAccountOption[]>([])
  const [accountId, setAccountId] = useState('')

  useEffect(() => {
    supabase.from('email_accounts').select('id,label,email,is_default').order('is_default', { ascending: false }).order('label').then(({ data }) => {
      setAccounts(data ?? [])
      const def = (data ?? []).find(a => a.is_default)
      if (def) setAccountId(def.id)
    })
  }, [supabase])

  async function send() {
    setResult(null)
    const addresses = to.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    if (!addresses.length) { setResult({ type: 'error', msg: 'Enter at least one recipient email.' }); return }
    if (!subject.trim())   { setResult({ type: 'error', msg: 'Subject is required.' }); return }

    setSending(true)
    try {
      const { filename, base64 } = await buildAttachment()
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: addresses,
          subject: subject.trim(),
          body: body.trim(),
          attachments: [{ filename, content: base64, contentType: 'application/pdf' }],
          ...(accountId ? { accountId } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to send')
      setResult({ type: 'success', msg: `Sent to ${json.sent} recipient${json.sent !== 1 ? 's' : ''}${json.fromEmail ? ` from ${json.fromEmail}` : ''}.` })

      if (logContext?.studentId || logContext?.donorId) {
        // Best-effort — the email already sent successfully, so a logging
        // failure here shouldn't surface as a send error to the user.
        const { error: logError } = await supabase.from('communications').insert([{
          type: 'email',
          subject: subject.trim(),
          body: body.trim(),
          student_id: logContext.studentId ?? null,
          donor_id: logContext.donorId ?? null,
          recipients: addresses.join(', '),
          attachment_filename: filename,
          pdf_base64: base64,
          sent_from_email: json.fromEmail ?? null,
        }])
        if (logError) console.warn('Failed to log sent letter:', logError.message)
      }
    } catch (err) {
      setResult({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to send' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Email PDF</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {result && (
          <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
            result.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {result.type === 'success'
              ? <Check size={14} className="mt-0.5 flex-shrink-0" />
              : <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />}
            {result.msg}
          </div>
        )}

        {accounts.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Send From</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {accounts.map(a => <option key={a.id} value={a.id}>{a.label} ({a.email})</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
          <input
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="parent@example.com"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {!defaultRecipients.length && (
            <p className="text-xs text-amber-600 mt-1">No email on file for this student — enter one manually.</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Message</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={5}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-slate-400">
            Sending via Google Workspace.{' '}
            <Link href="/admin/settings?tab=email" className="underline hover:text-slate-600">Configure in Settings</Link>
          </p>
          <button
            onClick={send}
            disabled={sending}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
