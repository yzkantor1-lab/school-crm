'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Plus } from 'lucide-react'

export default function BookForm() {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ title: '', author: '', isbn: '', category: 'library', total_copies: '1' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const copies = Number(form.total_copies) || 1
    const { error } = await supabase.from('books').insert([{ ...form, total_copies: copies, available_copies: copies }])
    if (error) { setError(error.message); setLoading(false) }
    else { setOpen(false); setForm({ title: '', author: '', isbn: '', category: 'library', total_copies: '1' }); router.refresh() }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
      <Plus size={16} /> Add Book
    </button>
  )

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-3">
      <h2 className="font-semibold text-slate-900">New Book</h2>
      {[['Title *', 'title', true], ['Author', 'author', false], ['ISBN', 'isbn', false]].map(([label, key, req]) => (
        <div key={key as string}>
          <label className="block text-xs font-medium text-slate-500 mb-1">{label as string}</label>
          <input value={(form as any)[key as string]} onChange={e => set(key as string, e.target.value)} required={req as boolean}
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      ))}
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
        <select value={form.category} onChange={e => set('category', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="library">Library</option>
          <option value="textbook">Textbook</option>
          <option value="reference">Reference</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Total Copies</label>
        <input type="number" min="1" value={form.total_copies} onChange={e => set('total_copies', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-4 py-2 rounded-lg disabled:opacity-50">
          {loading ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-600 text-xs px-4 py-2 rounded-lg border border-slate-200">Cancel</button>
      </div>
    </form>
  )
}
