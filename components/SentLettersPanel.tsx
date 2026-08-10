'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Mail, Printer, FileText, Eye } from 'lucide-react'

type SentLetter = {
  id: string
  type: string
  subject: string | null
  recipients: string | null
  attachment_filename: string | null
  pdf_base64: string | null
  created_at: string
}

// Reopens the exact document that was generated at send/print time — not a
// live regeneration, which could differ if balances have changed since.
// Plain click handler, no preceding async gap or dialog, so it's never
// popup-blocked (see lib/pdfPreview.ts for why that matters here).
function viewStoredPdf(base64: string) {
  const byteChars = atob(base64)
  const byteNumbers = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' })
  window.open(URL.createObjectURL(blob), '_blank')
}

// Shows the history of every PDF letter/receipt/statement generated for a
// given student or donor — both emailed (logged by EmailPdfModal) and
// printed (logged by the page's own confirmPendingPrint) — with exactly
// when it happened and, if the document was persisted, a way to reopen it.
// Always renders (even empty) so this is a reliable place to check before
// sending the same letter twice, not something that silently disappears.
export default function SentLettersPanel({ studentId, donorId }: { studentId?: string; donorId?: string }) {
  const supabase = createClient()
  const [letters, setLetters] = useState<SentLetter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      let query = supabase
        .from('communications')
        .select('id,type,subject,recipients,attachment_filename,pdf_base64,created_at')
        .in('type', ['email', 'print'])
        .order('created_at', { ascending: false })
      query = studentId ? query.eq('student_id', studentId) : query.eq('donor_id', donorId!)
      const { data } = await query
      if (!cancelled) { setLetters(data || []); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [studentId, donorId, supabase])

  if (loading) return null

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <FileText size={15} className="text-blue-500" /> Sent Letters
      </h2>
      {letters.length === 0 ? (
        <p className="text-sm text-slate-400">No letters printed or emailed yet.</p>
      ) : (
        <div className="space-y-2.5">
          {letters.map(l => {
            const sentAt = new Date(l.created_at)
            return (
              <div key={l.id} className="text-sm border-b border-slate-50 last:border-0 pb-2.5 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {l.type === 'email'
                      ? <Mail size={13} className="text-blue-500 shrink-0" />
                      : <Printer size={13} className="text-slate-400 shrink-0" />}
                    <span className="font-medium text-slate-800 truncate">{l.subject || '—'}</span>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">
                    {sentAt.toLocaleDateString()} {sentAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className="text-xs text-slate-500 truncate">
                    {l.type === 'email' ? (l.recipients || '—') : 'Printed'}
                    {l.attachment_filename ? ` · ${l.attachment_filename}` : ''}
                  </p>
                  {l.pdf_base64 && (
                    <button
                      onClick={() => viewStoredPdf(l.pdf_base64!)}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium shrink-0"
                    >
                      <Eye size={12} /> View
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
