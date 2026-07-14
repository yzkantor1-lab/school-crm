'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function CommunicationForm({ students, staff }: { students: any[]; staff: any[] }) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [form, setForm] = useState({ type: 'note', subject: '', body: '', student_id: '', staff_id: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess(false)
    const payload = { ...form, student_id: form.student_id || null, staff_id: form.staff_id || null, subject: form.subject || null }
    const { error } = await supabase.from('communications').insert([payload])
    if (error) { setError(error.message) }
    else { setSuccess(true); setForm({ type: 'note', subject: '', body: '', student_id: '', staff_id: '' }); router.refresh() }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-3 h-fit">
      <h2 className="font-semibold text-slate-900">New Entry</h2>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
        <select value={form.type} onChange={e => set('type', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="note">Note</option>
          <option value="email">Email</option>
          <option value="call">Phone Call</option>
          <option value="meeting">Meeting</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Student</label>
        <select value={form.student_id} onChange={e => set('student_id', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">None</option>
          {students.map(s => <option key={s.id} value={s.id}>{s.last_name}, {s.first_name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Staff Member</label>
        <select value={form.staff_id} onChange={e => set('staff_id', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">None</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.last_name}, {s.first_name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
        <input value={form.subject} onChange={e => set('subject', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Body *</label>
        <textarea value={form.body} onChange={e => set('body', e.target.value)} required rows={5}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
      {success && <p className="text-green-600 text-xs">Saved.</p>}
      <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg disabled:opacity-50">
        {loading ? 'Saving…' : 'Save Entry'}
      </button>
    </form>
  )
}
