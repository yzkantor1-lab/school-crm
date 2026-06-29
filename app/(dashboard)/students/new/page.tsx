'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function NewStudentPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    first_name: '', last_name: '', student_id: '', date_of_birth: '',
    gender: '', grade_level: '', enrollment_date: '', status: 'active',
    allergies: '', medical_notes: '', notes: '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || null]))
    const { error } = await supabase.from('students').insert([payload])
    if (error) { setError(error.message); setLoading(false) }
    else router.push('/students')
  }

  return (
    <div className="max-w-2xl">
      <Link href="/students" className="flex items-center gap-1 text-slate-500 hover:text-slate-700 text-sm mb-5">
        <ArrowLeft size={15} /> Back to Students
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">New Student</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="First Name *" value={form.first_name} onChange={v => set('first_name', v)} required />
          <Field label="Last Name *" value={form.last_name} onChange={v => set('last_name', v)} required />
          <Field label="Student ID" value={form.student_id} onChange={v => set('student_id', v)} />
          <Field label="Date of Birth" type="date" value={form.date_of_birth} onChange={v => set('date_of_birth', v)} />
          <Field label="Grade Level" value={form.grade_level} onChange={v => set('grade_level', v)} />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Gender</label>
            <select value={form.gender} onChange={e => set('gender', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select…</option>
              <option>Male</option><option>Female</option><option>Other</option>
            </select>
          </div>
          <Field label="Enrollment Date" type="date" value={form.enrollment_date} onChange={v => set('enrollment_date', v)} />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="graduated">Graduated</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </div>
        </div>

        <TextArea label="Allergies" value={form.allergies} onChange={v => set('allergies', v)} />
        <TextArea label="Medical Notes" value={form.medical_notes} onChange={v => set('medical_notes', v)} />
        <TextArea label="Notes" value={form.notes} onChange={v => set('notes', v)} />

        {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 rounded-lg transition disabled:opacity-50">
            {loading ? 'Saving…' : 'Save Student'}
          </button>
          <Link href="/students" className="text-sm text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition">Cancel</Link>
        </div>
      </form>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  )
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
    </div>
  )
}
