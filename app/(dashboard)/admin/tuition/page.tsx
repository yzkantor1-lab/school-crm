'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Search, GraduationCap, Plus, ChevronRight, Filter, X, UserPlus, BookOpen, CalendarDays, Users, AlertCircle } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import ExportButton from '@/components/ExportButton'
import { SCHOOL_YEAR_SEMESTERS } from '@/lib/semesters'

// There's no per-installment schedule in the data — payments are only ever
// logged once received, never as a pending/due row — so "outstanding by
// semester/month" is an estimate: each plan's total is spread evenly across
// the calendar days of its date range (weighted by how much of each bucket
// the plan actually overlaps), then payments are applied oldest-bucket-first
// so a bucket only shows as owed once earlier buckets are covered.
function daysInclusive(start: string, end: string): number {
  return Math.round((new Date(end + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime()) / 86400000) + 1
}

function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = aStart > bStart ? aStart : bStart
  const end = aEnd < bEnd ? aEnd : bEnd
  return start > end ? 0 : daysInclusive(start, end)
}

function planDateRange(plan: TuitionPlan): { start: string; end: string } | null {
  if (plan.start_date && plan.end_date) return { start: plan.start_date, end: plan.end_date }
  const yearGroup = SCHOOL_YEAR_SEMESTERS.find(g => g.year === plan.academic_year)
  return yearGroup ? { start: yearGroup.semesters[0].startDate, end: yearGroup.semesters[2].endDate } : null
}

type PlanBucket = { key: string; label: string; sortKey: number; startDate: string; amount: number }

function semesterBucketsForPlan(plan: TuitionPlan, expected: number): PlanBucket[] {
  const range = planDateRange(plan)
  if (!range || expected <= 0) return []
  const totalDays = daysInclusive(range.start, range.end)
  if (totalDays <= 0) return []
  const buckets: PlanBucket[] = []
  SCHOOL_YEAR_SEMESTERS.forEach((yearGroup, gi) => {
    yearGroup.semesters.forEach((sem, si) => {
      const overlap = overlapDays(range.start, range.end, sem.startDate, sem.endDate)
      if (overlap > 0) {
        buckets.push({
          key: `${yearGroup.year}-s${si}`,
          label: `${yearGroup.year} · Semester ${si + 1}`,
          sortKey: gi * 10 + si,
          startDate: sem.startDate,
          amount: expected * (overlap / totalDays),
        })
      }
    })
  })
  return buckets.sort((a, b) => a.sortKey - b.sortKey)
}

function monthBucketsForPlan(plan: TuitionPlan, expected: number): PlanBucket[] {
  const range = planDateRange(plan)
  if (!range || expected <= 0) return []
  const totalDays = daysInclusive(range.start, range.end)
  if (totalDays <= 0) return []
  const buckets: PlanBucket[] = []
  const cursor = new Date(range.start + 'T00:00:00')
  cursor.setDate(1)
  const endDate = new Date(range.end + 'T00:00:00')
  while (cursor <= endDate) {
    const y = cursor.getFullYear()
    const m = cursor.getMonth()
    const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`
    const monthEnd = new Date(y, m + 1, 0).toISOString().slice(0, 10)
    const overlap = overlapDays(range.start, range.end, monthStart, monthEnd)
    if (overlap > 0) {
      buckets.push({
        key: `${y}-${String(m + 1).padStart(2, '0')}`,
        label: cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        sortKey: y * 12 + m, // globally comparable across plans/years, unlike a local per-plan counter
        startDate: monthStart,
        amount: expected * (overlap / totalDays),
      })
    }
    cursor.setMonth(m + 1)
  }
  return buckets
}

// Applies `paid` to buckets oldest-first, leaving each bucket's unpaid remainder.
function applyPaidWaterfall(buckets: PlanBucket[], paid: number): PlanBucket[] {
  let remainingPaid = paid
  return buckets.map(b => {
    const applied = Math.min(remainingPaid, b.amount)
    remainingPaid -= applied
    return { ...b, amount: b.amount - applied }
  })
}

function groupOutstanding(rows: OutstandingRow[], studentIds: Set<string>) {
  const map = new Map<string, { label: string; sortKey: number; rows: OutstandingRow[] }>()
  for (const row of rows) {
    if (!studentIds.has(row.studentId)) continue
    if (!map.has(row.bucketLabel)) map.set(row.bucketLabel, { label: row.bucketLabel, sortKey: row.bucketSortKey, rows: [] })
    map.get(row.bucketLabel)!.rows.push(row)
  }
  return [...map.values()].sort((a, b) => a.sortKey - b.sortKey)
}

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
  // Positive balance sitting on an earlier academic year's plan than the one
  // being displayed — e.g. this year is paid in full but last year isn't.
  priorOutstandingAmount: number
  // computed for export
  activePlanYear: string
  activePlanStructure: string
  expected: number
}

type Tab = 'all' | 'year' | 'semester' | 'semester_due' | 'month_due'
type StatusFilter = 'all' | 'current' | 'graduated'

type TuitionPayment = {
  id: string
  tuition_plan_id: string
  amount: number
  status: string
  payment_type: string | null
}

// One estimated unpaid bucket (a semester or a month) for one plan, for the
// "outstanding by semester/month" breakdown views.
type OutstandingRow = {
  id: string
  studentId: string
  studentName: string
  academicYear: string
  amount: number
  bucketLabel: string
  bucketSortKey: number
}

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
  const [outstandingSemesterRows, setOutstandingSemesterRows] = useState<OutstandingRow[]>([])
  const [outstandingMonthRows, setOutstandingMonthRows] = useState<OutstandingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'has_plan' | 'no_plan'>('all')
  const [showOutstandingOnly, setShowOutstandingOnly] = useState(false)
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
    // Postgrest/Supabase errors are plain objects with a `message` (and often
    // `code`/`details`/`hint`), not `Error` instances — String(err) on those
    // just gives "[object Object]", so pull `.message` out explicitly.
    let msg: string
    if (lastErr instanceof Error) msg = lastErr.message
    else if (lastErr && typeof lastErr === 'object' && 'message' in lastErr) msg = String((lastErr as { message: unknown }).message)
    else msg = String(lastErr)
    throw new Error(`${label} — ${msg} (after ${attempts} attempts)`)
  }, [])

  // Routed through our own /api/tuition/payments endpoint (server-side), not
  // fetched from Supabase directly in the browser — some ad blockers / privacy
  // extensions block requests whose URL contains "payment", which was silently
  // killing this one fetch while sibling requests (students, tuition_plans)
  // on the same page went through fine.
  const fetchAllPayments = useCallback(async () => {
    return withRetry('payments', async () => {
      const res = await fetch('/api/tuition/payments')
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      return (await res.json()) as TuitionPayment[]
    })
  }, [withRetry])

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
      payments = await fetchAllPayments()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setDebugInfo(`Couldn't load tuition data: ${msg}`)
      setLoading(false)
      return
    }

    const planExpected = (p: TuitionPlan) =>
      Number(p.total_amount ?? 0) - Number(p.discount_amount ?? 0) + Number(p.building_fund_amount ?? 0)
    const planPaid = (p: TuitionPlan) =>
      payments.filter(pay => pay.tuition_plan_id === p.id).reduce((sum, pay) => sum + Number(pay.amount), 0)

    const enriched: StudentWithTuition[] = (studentsData || []).map(s => {
      const studentPlans = plans.filter(p => p.student_id === s.id)
      // Latest academic year first; an 'active' status only breaks a tie
      // between plans from the same year — a stale 'active' flag on an old
      // plan should never override a newer year's plan.
      const sortedPlans = [...studentPlans].sort((a, b) => {
        const yearCmp = (b.academic_year || '').localeCompare(a.academic_year || '')
        if (yearCmp !== 0) return yearCmp
        return (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
      })
      const activePlan = sortedPlans[0] || null

      const totalPaid = activePlan ? planPaid(activePlan) : 0
      const expected = activePlan ? planExpected(activePlan) : 0
      const balance = expected - totalPaid

      const priorOutstandingAmount = sortedPlans.slice(1)
        .reduce((sum, p) => sum + Math.max(0, planExpected(p) - planPaid(p)), 0)

      return {
        ...s,
        activePlan,
        totalPaid,
        balance,
        priorOutstandingAmount,
        activePlanYear: activePlan?.academic_year ?? '',
        activePlanStructure: activePlan?.payment_structure ?? '',
        expected,
      }
    })

    // Estimated outstanding-by-period: no pending/due-dated payment rows exist
    // in this data (payments are only ever logged once received), so each
    // plan's total is prorated across its date range into semester/month
    // buckets, then what's been paid is applied oldest-bucket-first — a bucket
    // only counts as outstanding once it has started and still has a balance.
    const studentById = new Map((studentsData || []).map(s => [s.id, s]))
    const today = new Date().toISOString().slice(0, 10)
    const outstandingSemester: OutstandingRow[] = []
    const outstandingMonth: OutstandingRow[] = []

    for (const plan of plans) {
      const student = studentById.get(plan.student_id)
      const expected = planExpected(plan)
      if (!student || expected <= 0) continue
      const paid = planPaid(plan)
      const studentName = [student.first_name, student.last_name].filter(Boolean).join(' ') || '—'

      for (const b of applyPaidWaterfall(semesterBucketsForPlan(plan, expected), paid)) {
        if (b.startDate > today || b.amount <= 0.01) continue
        outstandingSemester.push({
          id: `${plan.id}-${b.key}`, studentId: student.id, studentName,
          academicYear: plan.academic_year ?? '—', amount: b.amount,
          bucketLabel: b.label, bucketSortKey: b.sortKey,
        })
      }
      for (const b of applyPaidWaterfall(monthBucketsForPlan(plan, expected), paid)) {
        if (b.startDate > today || b.amount <= 0.01) continue
        outstandingMonth.push({
          id: `${plan.id}-${b.key}`, studentId: student.id, studentName,
          academicYear: plan.academic_year ?? '—', amount: b.amount,
          bucketLabel: b.label, bucketSortKey: b.sortKey,
        })
      }
    }

    setStudents(enriched)
    setOutstandingSemesterRows(outstandingSemester)
    setOutstandingMonthRows(outstandingMonth)
    setLoading(false)
  }, [supabase, withRetry, fetchAllPayments])

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
    const matchesOutstanding = !showOutstandingOnly || s.balance > 0 || s.priorOutstandingAmount > 0
    return matchesSearch && matchesFilter && matchesEnrollment && matchesOutstanding
  }), [students, search, filterStatus, enrollmentFilter, showOutstandingOnly])

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

  // Estimated outstanding buckets for students currently in view — oldest
  // (most overdue) first, so the most urgent ones surface at the top.
  const filteredStudentIds = useMemo(() => new Set(filtered.map(s => s.id)), [filtered])

  const byOutstandingSemester = useMemo(
    () => groupOutstanding(outstandingSemesterRows, filteredStudentIds),
    [outstandingSemesterRows, filteredStudentIds]
  )
  const byOutstandingMonth = useMemo(
    () => groupOutstanding(outstandingMonthRows, filteredStudentIds),
    [outstandingMonthRows, filteredStudentIds]
  )

  const totalStudentsWithPlan = students.filter(s => s.activePlan).length
  const totalExpected = students.reduce((sum, s) => sum + s.expected, 0)
  const totalCollected = students.reduce((sum, s) => sum + s.totalPaid, 0)
  const totalOutstanding = totalExpected - totalCollected

  const TABS = [
    { id: 'all' as Tab,      label: 'All Students',    icon: <Users size={14} /> },
    { id: 'year' as Tab,     label: 'By Academic Year', icon: <BookOpen size={14} /> },
    { id: 'semester' as Tab, label: 'By Semester',      icon: <CalendarDays size={14} /> },
    ...(showOutstandingOnly ? [
      { id: 'semester_due' as Tab, label: 'By Semester Due', icon: <CalendarDays size={14} /> },
      { id: 'month_due' as Tab,    label: 'By Month Due',    icon: <CalendarDays size={14} /> },
    ] : []),
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
        <button
          type="button"
          onClick={() => setShowOutstandingOnly(v => {
            const next = !v
            if (!next && (tab === 'semester_due' || tab === 'month_due')) setTab('all')
            return next
          })}
          title="Click to show only students with an outstanding balance"
          className={`text-left bg-white rounded-xl border shadow-sm p-4 transition-colors ${
            showOutstandingOnly ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-100 hover:border-red-200'
          }`}
        >
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide flex items-center justify-between">
            Outstanding
            {showOutstandingOnly && <span className="text-red-500 normal-case font-normal">Filtering ✕</span>}
          </p>
          <p className={`text-2xl font-bold mt-1 ${totalOutstanding > 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {formatCurrency(Math.max(0, totalOutstanding))}
          </p>
        </button>
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
      ) : tab === 'semester_due' || tab === 'month_due' ? (
        <div className="space-y-5">
          <p className="text-xs text-slate-400 italic">
            Estimated — plans aren&apos;t billed with a fixed schedule, so each plan&apos;s total is spread evenly
            across its date range and payments are applied to the oldest period first.
          </p>
          {(tab === 'semester_due' ? byOutstandingSemester : byOutstandingMonth).length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">Nothing outstanding.</div>
          )}
          {(tab === 'semester_due' ? byOutstandingSemester : byOutstandingMonth).map(group => (
            <div key={group.label} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <CalendarDays size={15} className="text-red-400" />
                  <span className="font-semibold text-slate-800 text-sm">{group.label}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {group.rows.length} payment{group.rows.length !== 1 ? 's' : ''} ·{' '}
                  <span className="text-red-600 font-medium">
                    {formatCurrency(group.rows.reduce((sum, r) => sum + r.amount, 0))}
                  </span>
                </div>
              </div>
              <OutstandingPaymentsTable rows={group.rows} />
            </div>
          ))}
        </div>
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
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <span className={`text-sm font-medium ${s.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {s.balance > 0 ? formatCurrency(s.balance) : 'Paid in Full'}
                    </span>
                    {s.priorOutstandingAmount > 0 && (
                      <span title={`Outstanding balance from a previous year: ${formatCurrency(s.priorOutstandingAmount)}`}>
                        <AlertCircle size={14} className="text-red-500 shrink-0" />
                      </span>
                    )}
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

function OutstandingPaymentsTable({ rows }: { rows: OutstandingRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Academic Year</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Est. Amount Due</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map(r => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-5 py-3">
                <Link href={`/admin/tuition/${r.studentId}`} className="text-sm font-medium text-slate-900 hover:text-blue-600 transition-colors">
                  {r.studentName}
                </Link>
              </td>
              <td className="px-5 py-3 text-sm text-slate-600 hidden md:table-cell">{r.academicYear}</td>
              <td className="px-5 py-3 text-right text-sm font-medium text-red-600">{formatCurrency(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">Nothing outstanding.</div>
      )}
    </div>
  )
}
