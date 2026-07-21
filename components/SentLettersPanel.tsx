'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Mail } from 'lucide-react'

type SentLetter = {
  id: string
  subject: string | null
  recipients: string | null
  attachment_filename: string | null
  created_at: string
}

// Shows the history of PDF letters/receipts/statements emailed for a given
// student or donor — logged by EmailPdfModal on every successful send — so
// it's easy to check whether something was already sent instead of guessing.
export default function SentLettersPanel({ studentId, donorId }: { studentId?: string; donorId?: string }) {
  const supabase = createClient()
  const [letters, setLetters] = useState<SentLetter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      let query = supabase
        .from('communications')
        .select('id,subject,recipients,attachment_filename,created_at')
        .eq('type', 'email')
        .order('created_at', { ascending: false })
      query = studentId ? query.eq('student_id', studentId) : query.eq('donor_id', donorId!)
      const { data } = await query
      if (!cancelled) { setLetters(data || []); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [studentId, donorId, supabase])

  if (loading || !letters.length) return null

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <Mail size={15} className="text-blue-500" /> Sent Letters
      </h2>
      <div className="space-y-2.5">
        {letters.map(l => (
          <div key={l.id} className="text-sm border-b border-slate-50 last:border-0 pb-2.5 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-800">{l.subject || '—'}</span>
              <span className="text-xs text-slate-400 shrink-0">{new Date(l.created_at).toLocaleDateString()}</span>
            </div>
            <p className="text-xs text-slate-500 truncate">
              {l.recipients}{l.attachment_filename ? ` · ${l.attachment_filename}` : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
