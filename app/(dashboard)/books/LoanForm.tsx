'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BookMarked } from 'lucide-react'

export default function LoanForm({ books }: { books: any[] }) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [students, setStudents] = useState<any[]>([])
  const [form, setForm] = useState({ book_id: '', student_id: '', due_date: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    supabase.from('students').select('id, first_name, last_name').eq('status', 'active').order('last_name').then(({ data }) => setStudents(data ?? []))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const book = books.find(b => b.id === form.book_id)
    if (!book || book.available_copies < 1) { setError('No copies available.'); setLoading(false); return }
    const [loanResult] = await Promise.all([
      supabase.from('book_loans').insert([{ ...form, due_date: form.due_date || null }]),
      supabase.from('books').update({ available_copies: book.available_copies - 1 }).eq('id', form.book_id),
    ])
    if (loanResult.error) { setError(loanResult.error.message) }
    else { setOpen(false); setForm({ book_id: '', student_id: '', due_date: '' }); router.refresh() }
    setLoading(false)
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
      <BookMarked size={16} /> Issue Loan
    </button>
  )

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-3">
      <h2 className="font-semibold text-slate-900">Issue Book Loan</h2>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Book *</label>
        <select value={form.book_id} onChange={e => set('book_id', e.target.value)} required
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Select book…</option>
          {books.filter(b => b.available_copies > 0).map(b => <option key={b.id} value={b.id}>{b.title} ({b.available_copies} avail.)</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Student *</label>
        <select value={form.student_id} onChange={e => set('student_id', e.target.value)} required
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Select student…</option>
          {students.map(s => <option key={s.id} value={s.id}>{s.last_name}, {s.first_name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Due Date</label>
        <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-4 py-2 rounded-lg disabled:opacity-50">
          {loading ? 'Saving…' : 'Issue Loan'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-600 text-xs px-4 py-2 rounded-lg border border-slate-200">Cancel</button>
      </div>
    </form>
  )
}
