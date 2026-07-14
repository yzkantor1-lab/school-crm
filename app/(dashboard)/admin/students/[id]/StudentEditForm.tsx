'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SCHOOL_YEAR_SEMESTERS, ALL_SEMESTER_VALUES } from '@/lib/semesters'

const field = (label: string, key: string) => ({ label, key, type: 'text' })
const dateField = (label: string, key: string) => ({ label, key, type: 'date' })

const GRADE_LEVELS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year']

const BASIC_FIELDS = [
  field('First Name', 'first_name'),
  field('Last Name', 'last_name'),
  field('Student ID', 'student_id'),
  field('Gender', 'gender'),
  dateField('Date of Birth', 'date_of_birth'),
]

const CONTACT_FIELDS = [
  field('Address', 'address'),
  field('Home Phone', 'home_phone'),
]

const PARENT_FIELDS = [
  field('Parents Title', 'parents_title'),
  field('Father Cell', 'father_cell'),
  field('Mother Cell', 'mother_cell'),
  field('Father Email', 'father_email'),
  field('Mother Email', 'mother_email'),
]

type StudentRow = Record<string, string | null>

export default function StudentEditForm({ student }: { student: StudentRow }) {
  const router = useRouter()
  const supabase = createClient()
  const [form, setForm] = useState<StudentRow>(student)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

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
    router.push('/admin/students')
  }

  return (
    <form onSubmit={handleSave} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-5">

      {/* Basic info */}
      <div>
        <h2 className="font-semibold text-slate-900 mb-3">Student Info</h2>
        <div className="space-y-3">
          {BASIC_FIELDS.map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
              <input
                type={type}
                value={form[key] ?? ''}
                onChange={e => set(key, e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Grade Level</label>
            <select
              value={form.grade_level ?? ''}
              onChange={e => set('grade_level', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select —</option>
              {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <select
              value={form.status ?? 'active'}
              onChange={e => set('status', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="graduated">Graduated</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </div>
        </div>
      </div>

      {/* Contact — family / parents home */}
      <div className="border-t border-slate-100 pt-4">
        <h2 className="font-semibold text-slate-900 mb-3">Family Home Contact</h2>
        <div className="space-y-3">
          {CONTACT_FIELDS.map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
              <input
                value={form[key] ?? ''}
                onChange={e => set(key, e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Parents */}
      <div className="border-t border-slate-100 pt-4">
        <h2 className="font-semibold text-slate-900 mb-3">Parents</h2>
        <div className="space-y-3">
          {PARENT_FIELDS.map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
              <input
                value={form[key] ?? ''}
                onChange={e => set(key, e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Semester Came</label>
            <select
              value={form.came_semester ?? ''}
              onChange={e => set('came_semester', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select semester —</option>
              {form.came_semester && !ALL_SEMESTER_VALUES.has(form.came_semester) && (
                <option value={form.came_semester}>{form.came_semester} (legacy)</option>
              )}
              {SCHOOL_YEAR_SEMESTERS.map(({ year, semesters }) => (
                <optgroup key={year} label={year}>
                  {semesters.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Sem 1: Elul → post-Yom Kippur · Sem 2: Cheshvan → 1 Nissan · Sem 3: Iyar → 1 Av
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Semester Left</label>
            <select
              value={form.semester_left ?? ''}
              onChange={e => set('semester_left', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select semester —</option>
              <option value="Still Active">Still Active</option>
              {form.semester_left && form.semester_left !== 'Still Active' && !ALL_SEMESTER_VALUES.has(form.semester_left) && (
                <option value={form.semester_left}>{form.semester_left} (legacy)</option>
              )}
              {SCHOOL_YEAR_SEMESTERS.map(({ year, semesters }) => (
                <optgroup key={year} label={year}>
                  {semesters.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Alumni / Personal Info */}
      <div className="border-t border-slate-100 pt-4">
        <h2 className="font-semibold text-slate-900 mb-1">Personal Info</h2>
        <p className="text-xs text-slate-400 mb-3">Alumni contact details separate from family.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Marital Status</label>
            <select
              value={form.marital_status ?? ''}
              onChange={e => set('marital_status', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select —</option>
              <option value="Single">Single</option>
              <option value="Married">Married</option>
              <option value="Divorced">Divorced</option>
              <option value="Widowed">Widowed</option>
              <option value="Separated">Separated</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Personal Phone</label>
            <input
              type="tel"
              value={form.personal_phone ?? ''}
              onChange={e => set('personal_phone', e.target.value)}
              placeholder="Graduate's own phone number"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Personal Address</label>
            <textarea
              value={form.personal_address ?? ''}
              onChange={e => set('personal_address', e.target.value)}
              rows={2}
              placeholder="Graduate's current home address"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>
      </div>

      {/* Spouse info — shown only when Married */}
      {form.marital_status === 'Married' && (
        <>
          <div className="border-t border-pink-100 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-semibold text-slate-900">Spouse</h2>
              <span className="text-xs text-pink-400 font-medium bg-pink-50 px-2 py-0.5 rounded-full">Married</span>
            </div>
            <div className="space-y-3">
              {([
                ['First Name', 'spouse_first_name', 'text'],
                ['Last Name',  'spouse_last_name',  'text'],
                ['Phone',      'spouse_phone',      'tel'],
                ['Email',      'spouse_email',      'email'],
              ] as const).map(([label, key, type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                  <input
                    type={type}
                    value={form[key] ?? ''}
                    onChange={e => set(key, e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-pink-100 pt-4">
            <h2 className="font-semibold text-slate-900 mb-1">In-Laws <span className="text-xs font-normal text-slate-400">(Spouse&apos;s Parents)</span></h2>
            <div className="space-y-3">
              {([
                ['Family Title / Name',   'inlaw_parents_title', 'text'],
                ['Father Name',           'inlaw_father_name',   'text'],
                ['Father Cell',           'inlaw_father_cell',   'tel'],
                ['Father Email',          'inlaw_father_email',  'email'],
                ['Mother Name',           'inlaw_mother_name',   'text'],
                ['Mother Cell',           'inlaw_mother_cell',   'tel'],
                ['Mother Email',          'inlaw_mother_email',  'email'],
              ] as const).map(([label, key, type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                  <input
                    type={type}
                    value={form[key] ?? ''}
                    onChange={e => set(key, e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">In-Laws Address</label>
                <textarea
                  value={form.inlaw_address ?? ''}
                  onChange={e => set('inlaw_address', e.target.value)}
                  rows={2}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Notes */}
      <div className="border-t border-slate-100 pt-4">
        <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
        <textarea
          value={form.notes ?? ''}
          onChange={e => set('notes', e.target.value)}
          rows={3}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {error && <p className="text-red-600 text-xs">{error}</p>}
      {success && <p className="text-green-600 text-xs">Saved.</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors">
          {loading ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={handleDelete}
          className="text-red-600 hover:bg-red-50 text-xs font-medium px-4 py-2 rounded-lg border border-red-200 transition">
          Delete
        </button>
      </div>
    </form>
  )
}
