'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Search, GraduationCap, ChevronRight, BookOpen, CalendarDays, Users } from 'lucide-react'
import ExportButton from '@/components/ExportButton'
import { SCHOOL_YEAR_SEMESTERS, ALL_SEMESTER_VALUES } from '@/lib/semesters'

const EXPORT_COLUMNS = [
  { header: 'First Name',      key: 'first_name' },
  { header: 'Last Name',       key: 'last_name' },
  { header: 'Marital Status',  key: 'marital_status' },
  { header: 'Personal Phone',  key: 'personal_phone' },
  { header: 'Personal Address',key: 'personal_address' },
  { header: 'Father Cell',     key: 'father_cell' },
  { header: 'Mother Cell',     key: 'mother_cell' },
  { header: 'Father Email',    key: 'father_email' },
  { header: 'Mother Email',    key: 'mother_email' },
  { header: 'Home Phone',      key: 'home_phone' },
  { header: 'Family Address',  key: 'address' },
  { header: 'Semester Came',   key: 'came_semester' },
  { header: 'Semester Left',   key: 'semester_left' },
  { header: 'Grade',           key: 'grade_level' },
]

type Alumni = {
  id: string
  first_name: string | null
  last_name: string | null
  student_id: string | null
  grade_level: string | null
  came_semester: string | null
  semester_left: string | null
  marital_status: string | null
  personal_phone: string | null
  personal_address: string | null
  address: string | null
  home_phone: string | null
  father_cell: string | null
  mother_cell: string | null
  father_email: string | null
  mother_email: string | null
  parents_title: string | null
}

type Tab = 'all' | 'year_came' | 'year_left'

function semesterSort(s: string | null): number {
  if (!s) return 99999
  const lower = s.toLowerCase()
  const yearMatch = lower.match(/\d{4}/)
  const year = yearMatch ? parseInt(yearMatch[0]) : 9999
  const order =
    lower.includes('elul')   ? 4 :
    lower.includes('succos') ? 5 :
    lower.includes('fall')   ? 4 :
    lower.includes('winter') ? 1 :
    lower.includes('spring') ? 2 :
    lower.includes('summer') ? 3 : 6
  return year * 10 + order
}

function extractYear(semValue: string | null): string {
  if (!semValue) return 'Unknown'
  const m = semValue.match(/(\d{4}[–-]\d{4})/)
  return m ? m[1] : semValue
}

const maritalBadge = (s: string | null) =>
  !s             ? 'bg-slate-50 text-slate-400' :
  s === 'Married'? 'bg-blue-50 text-blue-700'   :
  s === 'Single' ? 'bg-green-50 text-green-700'  :
  'bg-slate-100 text-slate-600'

export default function AlumniPage() {
  const supabase = createClient()
  const [alumni, setAlumni] = useState<Alumni[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase
      .from('students')
      .select('id,first_name,last_name,student_id,grade_level,came_semester,semester_left,marital_status,personal_phone,personal_address,address,home_phone,father_cell,mother_cell,father_email,mother_email,parents_title')
      .eq('status', 'graduated')
      .order('last_name')
      .then(({ data }) => { setAlumni(data || []); setLoading(false) })
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return alumni
    return alumni.filter(a =>
      [a.first_name, a.last_name, a.student_id, a.came_semester, a.semester_left,
       a.marital_status, a.personal_phone, a.father_cell, a.mother_cell,
       a.father_email, a.mother_email, a.parents_title, a.address, a.personal_address]
      .some(v => v?.toLowerCase().includes(q))
    )
  }, [alumni, search])

  // Group by school year they CAME
  const byYearCame = useMemo(() => {
    const map = new Map<string, Alumni[]>()
    for (const a of filtered) {
      const key = extractYear(a.came_semester)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(a)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  // Group by school year they LEFT
  const byYearLeft = useMemo(() => {
    const map = new Map<string, Alumni[]>()
    for (const a of filtered) {
      const key = extractYear(a.semester_left)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(a)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const TABS = [
    { id: 'all' as Tab,       label: 'All Alumni',      icon: <Users size={14} /> },
    { id: 'year_came' as Tab, label: 'By Year Came',    icon: <BookOpen size={14} /> },
    { id: 'year_left' as Tab, label: 'By Year Left',    icon: <CalendarDays size={14} /> },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Alumni</h1>
          <p className="text-sm text-slate-500 mt-0.5">All graduated students</p>
        </div>
      </div>

      {/* Search + Export + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, email, semester…"
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <ExportButton
          data={filtered}
          columns={EXPORT_COLUMNS}
          filename="alumni"
          title="Alumni List"
        />
        <div className="flex bg-slate-100 rounded-lg p-1 gap-1 self-start">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition whitespace-nowrap ${
                tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">Loading…</div>
      ) : tab === 'all' ? (
        <AlumniTable rows={filtered} search={search} />
      ) : (
        <div className="space-y-5">
          {(tab === 'year_came' ? byYearCame : byYearLeft).length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">
              {search ? 'No alumni match your search.' : 'No alumni yet.'}
            </div>
          )}
          {(tab === 'year_came' ? byYearCame : byYearLeft).map(([label, group]) => (
            <div key={label} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen size={15} className="text-blue-500" />
                  <span className="font-semibold text-slate-800 text-sm">{label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 font-medium">
                    {group.length} alumni
                  </span>
                  <ExportButton
                    data={group}
                    columns={EXPORT_COLUMNS}
                    filename={`alumni-${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}
                    title={`Alumni — ${label}`}
                    size="sm"
                  />
                </div>
              </div>
              <AlumniTable rows={group} search={search} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AlumniTable({ rows, search }: { rows: Alumni[]; search: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50">
          <tr>
            <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Marital</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Personal Phone</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Came</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Left</th>
            <th className="px-5 py-3 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map(a => {
            const name = [a.first_name, a.last_name].filter(Boolean).join(' ') || '—'
            return (
              <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3">
                  <Link href={`/admin/students/${a.id}`} className="group flex items-center gap-2.5">
                    <div className="bg-amber-100 p-1.5 rounded-lg flex-shrink-0">
                      <GraduationCap size={14} className="text-amber-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors leading-tight">{name}</p>
                      {a.parents_title && <p className="text-xs text-slate-400">{a.parents_title}</p>}
                    </div>
                  </Link>
                </td>
                <td className="px-5 py-3 hidden sm:table-cell">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${maritalBadge(a.marital_status)}`}>
                    {a.marital_status || '—'}
                  </span>
                </td>
                <td className="px-5 py-3 hidden md:table-cell">
                  <p className="text-slate-700 text-xs">{a.personal_phone || '—'}</p>
                  {a.personal_address && <p className="text-slate-400 text-xs truncate max-w-[180px]">{a.personal_address}</p>}
                </td>
                <td className="px-5 py-3 text-xs text-slate-500 hidden lg:table-cell">
                  {a.came_semester ? extractYear(a.came_semester) : '—'}
                </td>
                <td className="px-5 py-3 text-xs text-slate-500 hidden lg:table-cell">
                  {a.semester_left && a.semester_left !== 'Still Active'
                    ? extractYear(a.semester_left)
                    : a.semester_left || '—'}
                </td>
                <td className="px-3 py-3 text-right">
                  <Link href={`/admin/students/${a.id}`} className="text-slate-300 hover:text-slate-500 transition-colors">
                    <ChevronRight size={16} />
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">
          {search ? 'No alumni match your search.' : 'No alumni yet.'}
        </div>
      )}
    </div>
  )
}
