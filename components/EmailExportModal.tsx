'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X, Send, Loader2, Check, AlertCircle, FileText, Sheet } from 'lucide-react'
import { getExportCsvBase64, getExportPdfBase64, type ExportColumn } from '@/lib/export'

type Props = {
  onClose: () => void
  data: Record<string, unknown>[]
  columns: ExportColumn[]
  filename: string
  title?: string
}

export default function EmailExportModal({ onClose, data, columns, filename, title }: Props) {
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState(title ?? filename)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  async function send() {
    setResult(null)
    const addresses = to.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    if (!addresses.length) { setResult({ type: 'error', msg: 'Enter at least one recipient email.' }); return }
    if (!subject.trim())   { setResult({ type: 'error', msg: 'Subject is required.' }); return }

    setSending(true)
    try {
      const attachment = format === 'csv'
        ? { filename: `${filename}.csv`, content: getExportCsvBase64(data, columns), contentType: 'text/csv' }
        : { filename: `${filename}.pdf`, content: await getExportPdfBase64(data, columns, title ?? filename), contentType: 'application/pdf' }

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: addresses,
          subject: subject.trim(),
          body: body.trim(),
          attachments: [attachment],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to send')
      setResult({ type: 'success', msg: `Sent to ${json.sent} recipient${json.sent !== 1 ? 's' : ''}.` })
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
          <h2 className="font-semibold text-slate-900">Email Export</h2>
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

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Format</label>
          <div className="flex gap-2">
            <button
              onClick={() => setFormat('pdf')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                format === 'pdf' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <FileText size={14} className="text-red-500" /> PDF
            </button>
            <button
              onClick={() => setFormat('csv')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                format === 'csv' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Sheet size={14} className="text-green-600" /> Excel / CSV
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
          <input
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="someone@example.com"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
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
          <label className="block text-xs font-medium text-slate-500 mb-1">Message (optional)</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={4}
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
            disabled={sending || data.length === 0}
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
