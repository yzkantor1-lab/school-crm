'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Plus, Search, Users, CalendarDays, BookOpen, ChevronRight, GraduationCap } from 'lucide-react'
import ExportButton from '@/components/ExportButton'

const EXPORT_COLUMNS = [
  { header: 'First Name',    key: 'first_name' },
  { header: 'Last Name',     key: 'last_name' },
  { header: 'Address',       key: 'address' },
  { header: 'Home Phone',    key: 'home_phone' },
  { header: 'Father Cell',   key: 'father_cell' },
  { header: 'Mother Cell',   key: 'mother_cell' },
  { header: 'Father Email',  key: 'father_email' },
  { header: 'Mother Email',  key: 'mother_email' },
  { header: 'Parents Title', key: 'parents_title' },
  { header: 'Semester',      key: 'came_semester' },
  { header: 'Status',        key: 'status' },
  { header: 'Grade',         key: 'grade_level' },
]

type Student = {
  id: string
  first_name: string | null
  last_name: string | null
  student_id: string | null
  grade_level: string | null
  status: string | null
  address: string | null
  home_phone: string | null
  father_cell: string | null
  mother_cell: string | null
  father_email: string | null
  mother_email: string | null
  parents_title: string | null
  came_semester: string | null
  date_of_birth: string | null
}

type Tab = 'all' | 'semester' | 'year'
type StatusFilter = 'all' | 'current' | 'graduated'

// Semester → sortable number (chronological order)
function semesterSort(s: string | null): number {
  if (!s || s === 'Unknown') return 99999
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

// Semester → school year label (e.g. "2024-2025")
function getSchoolYear(semester: string | null): string {
  if (!semester) return 'Unknown'
  const lower = semester.toLowerCase()
  const yearMatch = semester.match(/\d{4}/)
  if (!yearMatch) return 'Unknown'
  const year = parseInt(yearMatch[0])
  const seasonFirst = /^(elul|summer|winter|succos|fall|spring)/i.test(semester.trim())

  if (lower.includes('elul') || lower.includes('succos') || lower.includes('fall')) {
    return `${year}-${year + 1}`
  }
  if (lower.includes('summer')) {
    return `${year - 1}-${year}`
  }
  if (lower.includes('winter')) {
    // "Winter 2025" = Jan 2025 → school year 2024-2025
    // "2024 Winter" = Dec 2024 → school year 2024-2025
    return seasonFirst ? `${year - 1}-${year}` : `${year}-${year + 1}`
  }
  return `${year}-${year + 1}`
}

const statusStyle = (s: string | null) =>
  s === 'active'    ? 'bg-green-100 text-green-700' :
  s === 'graduated' ? 'bg-blue-100 text-blue-700'   :
  s === 'withdrawn' ? 'bg-red-100 text-red-700'     :
  'bg-slate-100 text-slate-500'

export default function StudentsPage() {
  const supabase = createClient()
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('current')
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase
      .from('students')
      .select('id,first_name,last_name,student_id,grade_level,status,address,home_phone,father_cell,mother_cell,father_email,mother_email,parents_title,came_semester,date_of_birth')
      .order('last_name')
      .then(({ data }) => { setStudents(data || []); setLoading(false) })
  }, [])

  const q = search.toLowerCase()

  const filtered = useMemo(() => {
    const byStatus =
      statusFilter === 'all'       ? students :
      statusFilter === 'graduated' ? students.filter(s => s.status === 'graduated') :
      students.filter(s => s.status !== 'graduated')
    if (!q) return byStatus
    return byStatus.filter(s =>
      [s.first_name, s.last_name, s.address, s.home_phone,
       s.father_cell, s.mother_cell, s.father_email, s.mother_email,
       s.student_id, s.came_semester, s.parents_title]
      .some(v => v?.toLowerCase().includes(q))
    )
  }, [students, q, statusFilter])

  // Group by semester
  const bySemester = useMemo(() => {
    const map = new Map<string, Student[]>()
    for (const s of filtered) {
      const key = s.came_semester || 'Unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return [...map.entries()].sort(([a], [b]) => semesterSort(a) - semesterSort(b))
  }, [filtered])

  // Group by school year
  const byYear = useMemo(() => {
    const map = new Map<string, Student[]>()
    for (const s of filtered) {
      const key = getSchoolYear(s.came_semester)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const TABS = [
    { id: 'all' as Tab,      label: 'All Students', icon: <Users size={15} /> },
    { id: 'year' as Tab,     label: 'By School Year', icon: <BookOpen size={15} /> },
    { id: 'semester' as Tab, label: 'By Semester', icon: <CalendarDays size={15} /> },
  ]

  const STATUS_FILTERS = [
    { id: 'all' as StatusFilter,       label: 'All' },
    { id: 'current' as StatusFilter,   label: 'Current' },
    { id: 'graduated' as StatusFilter, label: 'Graduated' },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Students</h1>
        <Link
          href="/admin/students/new"
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          <Plus size={16} /> Add Student
        </Link>
      </div>

      {/* Search + Export + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, address, phone, email, semester…"
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <ExportButton
          data={filtered}
          columns={EXPORT_COLUMNS}
          filename={`students${search ? '-filtered' : ''}`}
          title="Student List"
        />
        <div className="flex bg-slate-100 rounded-lg p-1 gap-1 self-start flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition whitespace-nowrap ${
                statusFilter === f.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex bg-slate-100 rounded-lg p-1 gap-1 self-start flex-wrap">
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
        /* ── All Students ── */
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-xs text-slate-500 font-medium">{filtered.length} student{filtered.length !== 1 ? 's' : ''}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Semester</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Address</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Father Cell</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Mother Cell</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(s => <StudentRow key={s.id} s={s} showSemester={false} />)}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">
              {search ? 'No students match your search.' : 'No students yet.'}
            </div>
          )}
        </div>
      ) : (
        /* ── By School Year or By Semester ── */
        <div className="space-y-5">
          {(tab === 'year' ? byYear : bySemester).length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">
              {search ? 'No students match your search.' : 'No students yet.'}
            </div>
          )}
          {(tab === 'year' ? byYear : bySemester).map(([label, groupStudents]) => (
            <div key={label} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {tab === 'year'
                    ? <BookOpen size={15} className="text-blue-500" />
                    : <CalendarDays size={15} className="text-slate-400" />}
                  <span className="font-semibold text-slate-800 text-sm">{label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 font-medium">
                    {groupStudents.length} student{groupStudents.length !== 1 ? 's' : ''}
                  </span>
                  <ExportButton
                    data={groupStudents}
                    columns={EXPORT_COLUMNS}
                    filename={`students-${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}
                    title={`Students — ${label}`}
                    size="sm"
                  />
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100">
                  <tr>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                    {tab === 'year' && (
                      <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Semester</th>
                    )}
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Address</th>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Father Cell</th>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Mother Cell</th>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="px-5 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {groupStudents.map(s => (
                    <StudentRow key={s.id} s={s} showSemester={tab === 'year'} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StudentRow({ s, showSemester }: { s: Student; showSemester: boolean }) {
  const name = [s.first_name, s.last_name].filter(Boolean).join(' ') || '—'
  const city = (() => {
    if (!s.address) return null
    const parts = s.address.split(',')
    return parts.length >= 2 ? parts.slice(-3, -1).join(',').trim() : s.address
  })()

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-5 py-3">
        <Link href={`/admin/students/${s.id}`} className="group flex items-center gap-2.5">
          <div className="bg-blue-100 p-1.5 rounded-lg flex-shrink-0">
            <GraduationCap size={14} className="text-blue-600" />
          </div>
          <div>
            <p className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors leading-tight">{name}</p>
            {s.parents_title && <p className="text-xs text-slate-400">{s.parents_title}</p>}
          </div>
        </Link>
      </td>
      {/* Semester column: always in "All Students", only in "By Year" grouped view */}
      <td className="px-5 py-3 hidden sm:table-cell">
        <p className="text-slate-600 text-xs">{s.came_semester || '—'}</p>
      </td>
      <td className="px-5 py-3 hidden md:table-cell">
        <p className="text-slate-700 text-xs">{city || '—'}</p>
        {s.home_phone && <p className="text-slate-400 text-xs">{s.home_phone}</p>}
      </td>
      <td className="px-5 py-3 hidden lg:table-cell">
        <p className="text-slate-700 text-xs">{s.father_cell || '—'}</p>
        {s.father_email && <p className="text-slate-400 text-xs truncate max-w-[160px]">{s.father_email}</p>}
      </td>
      <td className="px-5 py-3 hidden lg:table-cell">
        <p className="text-slate-700 text-xs">{s.mother_cell || '—'}</p>
        {s.mother_email && <p className="text-slate-400 text-xs truncate max-w-[160px]">{s.mother_email}</p>}
      </td>
      <td className="px-5 py-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusStyle(s.status)}`}>
          {s.status || 'unknown'}
        </span>
      </td>
      <td className="px-3 py-3 text-right">
        <Link href={`/admin/students/${s.id}`} className="text-slate-300 hover:text-slate-500 transition-colors">
          <ChevronRight size={16} />
        </Link>
      </td>
    </tr>
  )
}
