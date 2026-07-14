'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Send, ChevronDown, ChevronUp, Loader2, Check, AlertCircle } from 'lucide-react'

export default function ComposeEmail() {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  async function send() {
    setResult(null)
    const addresses = to
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean)

    if (!addresses.length) { setResult({ type: 'error', msg: 'Enter at least one recipient email.' }); return }
    if (!subject.trim())   { setResult({ type: 'error', msg: 'Subject is required.' }); return }
    if (!body.trim())      { setResult({ type: 'error', msg: 'Message body is required.' }); return }

    setSending(true)
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: addresses, subject: subject.trim(), body: body.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to send')
      setResult({ type: 'success', msg: `Sent to ${json.sent} recipient${json.sent !== 1 ? 's' : ''}.` })
      setTo('')
      setSubject('')
      setBody('')
    } catch (err) {
      setResult({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to send' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Send size={16} className="text-blue-500" />
          <span className="text-sm font-semibold text-slate-800">Compose Email</span>
        </div>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
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

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              To <span className="font-normal text-slate-400">(paste from contact list, or enter comma/line separated)</span>
            </label>
            <textarea
              value={to}
              onChange={e => setTo(e.target.value)}
              rows={3}
              placeholder="email1@example.com, email2@example.com"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
            />
            {to.trim() && (
              <p className="text-xs text-slate-400 mt-1">
                {to.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length} recipient(s)
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject line…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={8}
              placeholder="Write your message here…"
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
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? 'Sending…' : 'Send Email'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
