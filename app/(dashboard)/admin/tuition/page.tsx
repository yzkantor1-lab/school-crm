'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Search, GraduationCap, Plus, ChevronRight, Filter, X, UserPlus, BookOpen, CalendarDays, Users } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import ExportButton from '@/components/ExportButton'
import { SCHOOL_YEAR_SEMESTERS } from '@/lib/semesters'

const TUITION_EXPORT_COLS = [
  { header: 'First Name',        key: 'first_name' },
  { header: 'Last Name',         key: 'last_name' },
  { header: 'Semester Came',     key: 'came_semester' },
  { header: 'Academic Year',     key: 'activePlanYear' },
  { header: 'Payment Structure', key: 'activePlanStructure' },
  { header: 'Building Fund',     key: 'buildingFund', format: (v: number) => v ? `$${v.toFixed(2)}` : '' },
  { header: 'Total Expected',    key: 'expected',  format: (v: number) => v ? `$${v.toFixed(2)}` : '' },
  { header: 'Total Paid',        key: 'totalPaid', format: (v: number) => v ? `$${v.toFixed(2)}` : '' },
  { header: 'Balance',           key: 'balance',   format: (v: number) => v ? `$${v.toFixed(2)}` : '' },
  { header: 'Status',            key: 'status' },
]

type Student = {
  id: string
  first_name: string | null
  last_name: string | null
  grade_level: string | null
  student_id: string | null
  status: string | null
  came_semester: string | null
}

type TuitionPlan = {
  id: string
  student_id: string
  academic_year: string | null
  total_amount: number | null
  payment_structure: string | null
  payment_amount: number | null
  start_date: string | null
  end_date: string | null
  status: string | null
  discount_amount: number | null
  building_fund_amount: number | null
}

type StudentWithTuition = Student & {
  activePlan: TuitionPlan | null
  totalPaid: number
  balance: number
  // computed for export
  activePlanYear: string
  activePlanStructure: string
  expected: number
}

type Tab = 'all' | 'year' | 'semester'
type StatusFilter = 'all' | 'current' | 'graduated'

type TuitionPayment = { id: string; tuition_plan_id: string; amount: number; status: string; payment_type: string | null }

function toExportRow(s: StudentWithTuition) {
  return {
    ...s,
    activePlanYear: s.activePlan?.academic_year ?? '',
    activePlanStructure: s.activePlan?.payment_structure ?? '',
    buildingFund: Number(s.activePlan?.building_fund_amount ?? 0),
    expected: s.activePlan
      ? Number(s.activePlan.total_amount ?? 0) - Number(s.activePlan.discount_amount ?? 0) + Number(s.activePlan.building_fund_amount ?? 0)
      : 0,
  }
}

// Semester sort priority (mirrors students page)
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

const defaultForm = {
  first_name: '',
  last_name: '',
  grade_level: '',
  student_id: '',
  date_of_birth: '',
  status: 'active',
  came_semester: '',
  notes: '',
}

export default function TuitionPage() {
  const supabase = createClient()
  const router = useRouter()
  const [students, setStudents] = useState<StudentWithTuition[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'has_plan' | 'no_plan'>('all')
  const [enrollmentFilter, setEnrollmentFilter] = useState<StatusFilter>('current')
  const [tab, setTab] = useState<Tab>('all')

  const [showAddStudent, setShowAddStudent] = useState(false)
  const [form, setForm] = useState(defaultForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [debugInfo, setDebugInfo] = useState<string | null>(null)

  // The connection to Supabase from some networks drops requests intermittently,
  // so every fetch here retries a few times with a short backoff before giving up.
  const withRetry = useCallback(async <T,>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> => {
    let lastErr: unknown
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn()
      } catch (e) {
        lastErr = e
        if (i < attempts - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)))
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
    throw new Error(`${label} — ${msg} (after ${attempts} attempts)`)
  }, [])

  // Paginates with a cursor (id > lastSeenId) instead of supabase-js's .range() —
  // .range() sends an HTTP Range header and expects a 206 response, which some
  // networks/proxies mishandle for API (non-media) responses. Cursor pagination
  // avoids that header entirely while still going through the normal, already-
  // authenticated Supabase client (rather than a hand-rolled fetch with manually
  // embedded auth headers, which is more fragile and easier for network/browser
  // issues to trip up).
  const fetchAllPaidPayments = useCallback(async () => {
    const pageSize = 50
    const all: TuitionPayment[] = []
    let cursor = '00000000-0000-0000-0000-000000000000'
    while (true) {
      const page = await withRetry(`payments page after ${cursor}`, async () => {
        const { data, error } = await supabase
          .from('tuition_payments')
          .select('id,tuition_plan_id,amount,status,payment_type')
          .eq('status', 'paid')
          .in('payment_type', ['tuition', 'building_fund'])
          .gt('id', cursor)
          .order('id')
          .limit(pageSize)
        if (error) throw error
        return (data || []) as TuitionPayment[]
      })
      all.push(...page)
      if (page.length < pageSize) break
      cursor = page[page.length - 1].id
    }
    return all
  }, [withRetry, supabase])

  const loadData = useCallback(async () => {
    setLoading(true)
    setDebugInfo(null)
    let studentsData: Student[] | null = null
    let plans: TuitionPlan[] = []
    let payments: TuitionPayment[] = []
    try {
      // Fetched one at a time, not in parallel — running these concurrently was
      // hitting a connection cap on some networks and silently dropping the
      // payments request every time, even though each one works fine alone.
      studentsData = await withRetry('students', async () => {
        const { data, error } = await supabase.from('students').select('id,first_name,last_name,grade_level,student_id,status,came_semester').order('last_name')
        if (error) throw error
        return data
      })
      plans = await withRetry('tuition_plans', async () => {
        const { data, error } = await supabase.from('tuition_plans').select('*')
        if (error) throw error
        return data || []
      })
      payments = await fetchAllPaidPayments()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setDebugInfo(`Couldn't load tuition data: ${msg}`)
      setLoading(false)
      return
    }

    const enriched: StudentWithTuition[] = (studentsData || []).map(s => {
      const studentPlans = plans.filter(p => p.student_id === s.id)
      const activePlan = studentPlans.find(p => p.status === 'active') || studentPlans[0] || null
      const planIds = studentPlans.map(p => p.id)
      const totalPaid = payments
        .filter(p => planIds.includes(p.tuition_plan_id))
        .reduce((sum, p) => sum + Number(p.amount), 0)
      const expected = activePlan
        ? Number(activePlan.total_amount ?? 0) - Number(activePlan.discount_amount ?? 0) + Number(activePlan.building_fund_amount ?? 0)
        : 0
      const balance = expected - totalPaid

      return {
        ...s,
        activePlan,
        totalPaid,
        balance,
        activePlanYear: activePlan?.academic_year ?? '',
        activePlanStructure: activePlan?.payment_structure ?? '',
        expected,
      }
    })

    setStudents(enriched)
    setLoading(false)
  }, [supabase, withRetry, fetchAllPaidPayments])

  /* eslint-disable react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await */
  useEffect(() => {
    loadData()
  }, [loadData])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleAddStudent(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError('')

    const { data, error } = await supabase
      .from('students')
      .insert([{
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        grade_level: form.grade_level.trim() || null,
        student_id: form.student_id.trim() || null,
        date_of_birth: form.date_of_birth || null,
        status: form.status,
        came_semester: form.came_semester || null,
        notes: form.notes.trim() || null,
      }])
      .select('id')
      .single()

    setSaving(false)

    if (error) {
      setFormError(error.message.includes('unique') ? 'That Student ID is already in use.' : error.message)
      return
    }

    router.push(`/admin/tuition/${data.id}`)
  }

  const filtered = useMemo(() => students.filter(s => {
    const q = search.toLowerCase()
    const name = [s.first_name, s.last_name].filter(Boolean).join(' ').toLowerCase()
    const matchesSearch =
      name.includes(q) ||
      s.student_id?.toLowerCase().includes(q) ||
      s.grade_level?.toLowerCase().includes(q) ||
      s.came_semester?.toLowerCase().includes(q) ||
      s.activePlan?.academic_year?.toLowerCase().includes(q)
    const matchesFilter =
      filterStatus === 'all' ||
      (filterStatus === 'has_plan' && s.activePlan) ||
      (filterStatus === 'no_plan' && !s.activePlan)
    const matchesEnrollment =
      enrollmentFilter === 'all' ||
      (enrollmentFilter === 'graduated' ? s.status === 'graduated' : s.status !== 'graduated')
    return matchesSearch && matchesFilter && matchesEnrollment
  }), [students, search, filterStatus, enrollmentFilter])

  // Group by academic year
  const byYear = useMemo(() => {
    const map = new Map<string, StudentWithTuition[]>()
    for (const s of filtered) {
      const key = s.activePlan?.academic_year || 'No Plan'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === 'No Plan') return 1
      if (b === 'No Plan') return -1
      return b.localeCompare(a) // newest year first
    })
  }, [filtered])

  // Group by semester came
  const bySemester = useMemo(() => {
    const map = new Map<string, StudentWithTuition[]>()
    for (const s of filtered) {
      const key = s.came_semester || 'Unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return [...map.entries()].sort(([a], [b]) => semesterSort(a) - semesterSort(b))
  }, [filtered])

  const totalStudentsWithPlan = students.filter(s => s.activePlan).length
  const totalExpected = students.reduce((sum, s) => sum + s.expected, 0)
  const totalCollected = students.reduce((sum, s) => sum + s.totalPaid, 0)
  const totalOutstanding = totalExpected - totalCollected

  const TABS = [
    { id: 'all' as Tab,      label: 'All Students',    icon: <Users size={14} /> },
    { id: 'year' as Tab,     label: 'By Academic Year', icon: <BookOpen size={14} /> },
    { id: 'semester' as Tab, label: 'By Semester',      icon: <CalendarDays size={14} /> },
  ]

  const ENROLLMENT_FILTERS = [
    { id: 'all' as StatusFilter,       label: 'All' },
    { id: 'current' as StatusFilter,   label: 'Current' },
    { id: 'graduated' as StatusFilter, label: 'Graduated' },
  ]

  return (
    <div className="space-y-6">
      {debugInfo && (
        <div className="rounded-lg px-4 py-2.5 text-sm bg-red-50 text-red-700 border border-red-200 flex items-center justify-between gap-3">
          <span>{debugInfo}</span>
          <button onClick={loadData} className="text-xs font-medium underline hover:no-underline flex-shrink-0">Retry</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tuition</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage tuition plans and track payments per student</p>
        </div>
        <button
          onClick={() => { setShowAddStudent(v => !v); setForm(defaultForm); setFormError('') }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          {showAddStudent ? <X size={16} /> : <UserPlus size={16} />}
          {showAddStudent ? 'Cancel' : 'Add Student'}
        </button>
      </div>

      {/* Add student form */}
      {showAddStudent && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-semibold text-slate-900 mb-1">New Student</h2>
          <p className="text-xs text-slate-400 mb-4">
            This student will also appear in the{' '}
            <Link href="/admin/students" className="text-blue-600 hover:underline">Students</Link>{' '}
            tab — no duplicates.
          </p>
          <form onSubmit={handleAddStudent} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">First Name</label>
              <input
                value={form.first_name}
                onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Last Name</label>
              <input
                value={form.last_name}
                onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Grade Level</label>
              <select
                value={form.grade_level}
                onChange={e => setForm(f => ({ ...f, grade_level: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select —</option>
                <option>First Year</option>
                <option>Second Year</option>
                <option>Third Year</option>
                <option>Fourth Year</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Starting Semester</label>
              <select
                value={form.came_semester}
                onChange={e => setForm(f => ({ ...f, came_semester: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select semester —</option>
                {SCHOOL_YEAR_SEMESTERS.map(({ year, semesters }) => (
                  <optgroup key={year} label={year}>
                    {semesters.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">Includes upcoming semesters — pick a future one to pre-register a student.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Student ID</label>
              <input
                value={form.student_id}
                onChange={e => setForm(f => ({ ...f, student_id: e.target.value }))}
                placeholder="School-assigned ID"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Date of Birth</label>
              <input
                type="date"
                value={form.date_of_birth}
                onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="graduated">Graduated</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
              <input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {formError && (
              <p className="sm:col-span-2 lg:col-span-3 text-red-600 text-xs">{formError}</p>
            )}
            <div className="sm:col-span-2 lg:col-span-3 flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {saving ? 'Creating…' : 'Create Student'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddStudent(false)}
                className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Students with Plans</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalStudentsWithPlan}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Expected</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalExpected)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Collected</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(totalCollected)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Outstanding</p>
          <p className={`text-2xl font-bold mt-1 ${totalOutstanding > 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {formatCurrency(Math.max(0, totalOutstanding))}
          </p>
        </div>
      </div>

      {/* Search + Filter + Export + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, ID, grade, semester, year…"
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Students</option>
            <option value="has_plan">Has Tuition Plan</option>
            <option value="no_plan">No Tuition Plan</option>
          </select>
        </div>
        <ExportButton
          data={filtered.map(toExportRow)}
          columns={TUITION_EXPORT_COLS}
          filename="tuition"
          title="Tuition Report"
        />
        <div className="flex bg-slate-100 rounded-lg p-1 gap-1 self-start flex-wrap">
          {ENROLLMENT_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setEnrollmentFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition whitespace-nowrap ${
                enrollmentFilter === f.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
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

      {/* Student list */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
      ) : tab === 'all' ? (
        <TuitionTable students={filtered} />
      ) : (
        <div className="space-y-5">
          {(tab === 'year' ? byYear : bySemester).length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">
              {search ? 'No students match your search.' : 'No students yet.'}
            </div>
          )}
          {(tab === 'year' ? byYear : bySemester).map(([label, group]) => {
            const groupTotals = group.reduce(
              (acc, s) => ({ expected: acc.expected + s.expected, paid: acc.paid + s.totalPaid }),
              { expected: 0, paid: 0 }
            )
            return (
              <div key={label} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    {tab === 'year'
                      ? <BookOpen size={15} className="text-blue-500" />
                      : <CalendarDays size={15} className="text-slate-400" />}
                    <span className="font-semibold text-slate-800 text-sm">{label}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>{group.length} student{group.length !== 1 ? 's' : ''}</span>
                      {groupTotals.expected > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-slate-700">{formatCurrency(groupTotals.paid)} / {formatCurrency(groupTotals.expected)}</span>
                        </>
                      )}
                    </div>
                    <ExportButton
                      data={group.map(toExportRow)}
                      columns={TUITION_EXPORT_COLS}
                      filename={`tuition-${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}
                      title={`Tuition — ${label}`}
                      size="sm"
                    />
                  </div>
                </div>
                <TuitionTable students={group} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TuitionTable({ students }: { students: StudentWithTuition[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Year / Plan</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Expected</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Paid</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Balance</th>
            <th className="px-5 py-3 w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {students.map(s => (
            <tr key={s.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-5 py-3.5">
                <Link href={`/admin/tuition/${s.id}`} className="flex items-center gap-3 group">
                  <div className="bg-blue-100 p-1.5 rounded-lg flex-shrink-0">
                    <GraduationCap size={16} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900 text-sm group-hover:text-blue-600 transition-colors">
                      {[s.first_name, s.last_name].filter(Boolean).join(' ') || '—'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {s.grade_level && `${s.grade_level}`}{s.student_id && ` · ${s.student_id}`}
                    </p>
                  </div>
                </Link>
              </td>
              <td className="px-5 py-3.5 hidden md:table-cell">
                {s.activePlan ? (
                  <div>
                    <p className="text-sm text-slate-700">{s.activePlan.academic_year}</p>
                    <p className="text-xs text-slate-400 capitalize">{s.activePlan.payment_structure}</p>
                  </div>
                ) : (
                  <Link
                    href={`/admin/tuition/${s.id}`}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <Plus size={12} />
                    Add plan
                  </Link>
                )}
              </td>
              <td className="px-5 py-3.5 text-right text-sm text-slate-700 hidden lg:table-cell">
                {s.expected > 0 ? formatCurrency(s.expected) : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-5 py-3.5 text-right text-sm text-green-600 hidden lg:table-cell">
                {s.totalPaid > 0 ? formatCurrency(s.totalPaid) : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-5 py-3.5 text-right">
                {s.expected > 0 ? (
                  <span className={`text-sm font-medium ${s.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {s.balance > 0 ? formatCurrency(s.balance) : 'Paid in Full'}
                  </span>
                ) : (
                  <span className="text-slate-300 text-sm">—</span>
                )}
              </td>
              <td className="px-3 py-3.5">
                <Link href={`/admin/tuition/${s.id}`} className="text-slate-300 hover:text-slate-500 transition-colors">
                  <ChevronRight size={16} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {students.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">No students found.</div>
      )}
    </div>
  )
}
