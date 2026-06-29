'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function StudentEditForm({ student }: { student: any }) {
  const router = useRouter()
  const supabase = createClient()
  const [form, setForm] = useState(student)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess(false)
    const { error } = await supabase.from('students').update(form).eq('id', student.id)
    if (error) { setError(error.message) } else { setSuccess(true); router.refresh() }
    setLoading(false)
  }

  async function handleDelete() {
    if (!confirm('Delete this student? This cannot be undone.')) return
    await supabase.from('students').delete().eq('id', student.id)
    router.push('/students')
  }

  return (
    <form onSubmit={handleSave} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-4">
      <h2 className="font-semibold text-slate-900">Student Info</h2>
      {[
        ['First Name', 'first_name'], ['Last Name', 'last_name'], ['Student ID', 'student_id'],
        ['Grade Level', 'grade_level'], ['Gender', 'gender'],
      ].map(([label, key]) => (
        <div key={key}>
          <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
          <input value={form[key] ?? ''} onChange={e => set(key, e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      ))}
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
        <select value={form.status ?? 'active'} onChange={e => set('status', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="graduated">Graduated</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
        <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} rows={2}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
      {success && <p className="text-green-600 text-xs">Saved.</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-4 py-2 rounded-lg disabled:opacity-50">
          {loading ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={handleDelete} className="text-red-600 hover:bg-red-50 text-xs font-medium px-4 py-2 rounded-lg border border-red-200 transition">
          Delete
        </button>
      </div>
    </form>
  )
}
