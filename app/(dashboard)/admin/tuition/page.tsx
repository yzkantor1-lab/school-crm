'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Search, GraduationCap, Plus, ChevronRight, Filter, X, UserPlus, BookOpen, CalendarDays, Users, AlertCircle, Repeat } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import ExportButton from '@/components/ExportButton'
import ManageRecurringModal from '@/components/sola/ManageRecurringModal'
import IncomingSolaBadge from '@/components/sola/IncomingSolaBadge'
import { SCHOOL_YEAR_SEMESTERS, currentGradeLevel } from '@/lib/semesters'
import PeriodSelect from '@/components/PeriodSelect'
import { currentYearPeriod, currentSchoolYear, periodDateRange, selectableYears, type Period } from '@/lib/periods'
import {
  applyPaidWaterfall, monthBucketsForPlan, planExpected, semesterBucketsForPlan, studentForPeriod,
  type ActiveSchedule, type RawSchedule, type Student, type StudentWithTuition, type TuitionPlan,
} from '@/lib/tuitionPeriods'


function groupOutstanding(rows: OutstandingRow[], studentIds: Set<string>, range: { start: string; end: string } | null) {
  const map = new Map<string, { label: string; sortKey: number; rows: OutstandingRow[] }>()
  for (const row of rows) {
    if (!studentIds.has(row.studentId)) continue
    if (range && (row.bucketStart < range.start || row.bucketStart > range.end)) continue
    if (!map.has(row.bucketLabel)) map.set(row.bucketLabel, { label: row.bucketLabel, sortKey: row.bucketSortKey, rows: [] })
    map.get(row.bucketLabel)!.rows.push(row)
  }
  return [...map.values()].sort((a, b) => a.sortKey - b.sortKey)
}

const TUITION_EXPORT_COLS = [
  { header: 'First Name',        key: 'first_name' },
  { header: 'Last Name',         key: 'last_name' },
  { header: 'Semester Came',     key: 'came_semester' },
  { header: 'Period',            key: 'activePlanYear' },
  { header: 'Payment Structure', key: 'activePlanStructure' },
  { header: 'Building Fund',     key: 'buildingFund', format: (v: number) => v ? `$${v.toFixed(2)}` : '' },
  { header: 'Total Expected',    key: 'expected',  format: (v: number) => v ? `$${v.toFixed(2)}` : '' },
  { header: 'Total Paid',        key: 'totalPaid', format: (v: number) => v ? `$${v.toFixed(2)}` : '' },
  { header: 'Balance',           key: 'balance',   format: (v: number) => v ? `$${v.toFixed(2)}` : '' },
  { header: 'Status',            key: 'status' },
  { header: 'Recurring',         key: 'recurringLabel' },
]


type Tab = 'all' | 'year' | 'semester' | 'semester_due' | 'month_due'
type StatusFilter = 'all' | 'current' | 'graduated'

type TuitionPayment = {
  id: string
  tuition_plan_id: string
  amount: number
  status: string
  payment_type: string | null
  payment_date: string | null
}

// One bucket (a semester or a month) for one plan, for the "outstanding by
// semester/month" report views. `received` is real money actually paid
// during that period; `outstanding` is the estimated remainder still owed.
type OutstandingRow = {
  id: string
  studentId: string
  studentName: string
  academicYear: string
  received: number
  outstanding: number
  bucketLabel: string
  bucketSortKey: number
  bucketStart: string
}

const SCHEDULE_PURPOSE_LABEL: Record<string, string> = {
  tuition: 'Tuition',
  building_fund: 'Building Fund',
  phone_charge: 'Phone Charge',
}

function scheduleSummary(sch: ActiveSchedule): string {
  const label = SCHEDULE_PURPOSE_LABEL[sch.purpose] ?? sch.purpose
  const cadence = sch.intervalCount === 1 ? `every ${sch.intervalType}` : `every ${sch.intervalCount} ${sch.intervalType}s`
  return `${label}: ${formatCurrency(sch.amount)} ${cadence}`
}

function toExportRow(s: StudentWithTuition) {
  return { ...s, recurringLabel: s.activeSchedules.map(scheduleSummary).join('; ') }
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
  const [rawStudents, setRawStudents] = useState<Student[]>([])
  const [allPlans, setAllPlans] = useState<TuitionPlan[]>([])
  const [allPayments, setAllPayments] = useState<TuitionPayment[]>([])
  const [allSchedules, setAllSchedules] = useState<RawSchedule[]>([])
  // Defaults to the current school year; staff can switch to a past year,
  // one semester, or all years to see who's outstanding over any stretch.
  const [period, setPeriod] = useState<Period>(currentYearPeriod)
  const [outstandingSemesterRows, setOutstandingSemesterRows] = useState<OutstandingRow[]>([])
  const [outstandingMonthRows, setOutstandingMonthRows] = useState<OutstandingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingSola, setPendingSola] = useState<Map<string, { count: number; total: number }>>(new Map())
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'has_plan' | 'no_plan'>('all')
  const [recurringFilter, setRecurringFilter] = useState<'all' | 'has_recurring' | 'no_recurring'>('all')
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

  const loadData = useCallback(async () => {
    setLoading(true)
    setDebugInfo(null)
    let studentsData: Student[] | null = null
    let plans: TuitionPlan[] = []
    let payments: TuitionPayment[] = []
    let schedules: RawSchedule[] = []
    try {
      // Fetched one at a time, not in parallel — running these concurrently was
      // hitting a connection cap on some networks and silently dropping the
      // payments request every time, even though each one works fine alone.
      studentsData = await withRetry('students', async () => {
        const { data, error } = await supabase.from('students').select('id,first_name,last_name,grade_level,student_id,status,came_semester').order('last_name')
        if (error) throw error
        return data
      })
      // Payments are embedded directly in this same request (a Supabase
      // nested/relational select), not fetched from a separate endpoint —
      // a network-level content filter on at least one real school's
      // network blocks any request under /api/tuition/* regardless of what
      // it's named (confirmed live: renaming /api/tuition/payments to
      // /api/tuition/records still got blocked, identical "GenTech
      // BlockPage" response). The only reliable fix is not having a
      // separate URL for this data at all — piggyback on the tuition_plans
      // request, which is already proven to get through.
      const plansWithPayments = await withRetry('tuition_plans', async () => {
        const { data, error } = await supabase
          .from('tuition_plans')
          .select('*, tuition_payments(id,tuition_plan_id,amount,status,payment_type,payment_date)')
        if (error) throw error
        return data || []
      })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit it from the rest spread
      plans = plansWithPayments.map(({ tuition_payments: _tp, ...plan }) => plan) as TuitionPlan[]
      // Same filter the old dedicated endpoint applied server-side — only
      // these count toward a plan's paid total (matches planPaid/planExpected
      // below, which assume payments arriving here are already narrowed to
      // this set).
      payments = plansWithPayments.flatMap(p =>
        ((p.tuition_payments ?? []) as TuitionPayment[]).filter(pay =>
          ['paid', 'partial', 'forgiven'].includes(pay.status) && ['tuition', 'building_fund'].includes(pay.payment_type ?? '')
        )
      )
      // Active Sola recurring schedules — any purpose (tuition, building
      // fund, phone charge), not just fixed-#-of-payments plans — so staff
      // can see at a glance who actually has recurring billing running.
      schedules = await withRetry('payment_schedules', async () => {
        const { data, error } = await supabase
          .from('payment_schedules')
          .select('id,student_id,purpose,amount,interval_type,interval_count,total_payments,payment_method_id')
          .eq('status', 'active')
          .not('student_id', 'is', null)
        if (error) throw error
        return data || []
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setDebugInfo(`Couldn't load tuition data: ${msg}`)
      setLoading(false)
      return
    }

    const planPaid = (p: TuitionPlan) =>
      payments.filter(pay => pay.tuition_plan_id === p.id).reduce((sum, pay) => sum + Number(pay.amount), 0)

    // Estimated outstanding-by-period: no pending/due-dated payment rows exist
    // in this data (payments are only ever logged once received), so each
    // plan's total is prorated across its date range into semester/month
    // buckets, then what's been paid is applied oldest-bucket-first — a bucket
    // only counts as outstanding once it has started and still has a balance.
    // Report is scoped to currently-enrolled students only (status active),
    // regardless of whatever enrollment filter is selected elsewhere on the
    // page — a graduated/withdrawn student's old balance doesn't belong here.
    const studentById = new Map((studentsData || []).map(s => [s.id, s]))
    const today = new Date().toISOString().slice(0, 10)
    const outstandingSemester: OutstandingRow[] = []
    const outstandingMonth: OutstandingRow[] = []

    for (const plan of plans) {
      const student = studentById.get(plan.student_id)
      const expected = planExpected(plan)
      if (!student || student.status !== 'active' || expected <= 0) continue
      const paid = planPaid(plan)
      const studentName = [student.first_name, student.last_name].filter(Boolean).join(' ') || '—'
      const planPayments = payments.filter(pay => pay.tuition_plan_id === plan.id)
      const receivedInRange = (start: string, end: string) =>
        planPayments
          .filter(pay => pay.payment_date && pay.payment_date >= start && pay.payment_date <= end)
          .reduce((sum, pay) => sum + Number(pay.amount), 0)

      for (const b of applyPaidWaterfall(semesterBucketsForPlan(plan, expected), paid)) {
        if (b.startDate > today) continue
        const received = receivedInRange(b.startDate, b.endDate)
        if (b.amount <= 0.01 && received <= 0.01) continue
        outstandingSemester.push({
          id: `${plan.id}-${b.key}`, studentId: student.id, studentName,
          academicYear: plan.academic_year ?? '—', received, outstanding: b.amount,
          bucketLabel: b.label, bucketSortKey: b.sortKey, bucketStart: b.startDate,
        })
      }
      for (const b of applyPaidWaterfall(monthBucketsForPlan(plan, expected), paid)) {
        if (b.startDate > today) continue
        const received = receivedInRange(b.startDate, b.endDate)
        if (b.amount <= 0.01 && received <= 0.01) continue
        outstandingMonth.push({
          id: `${plan.id}-${b.key}`, studentId: student.id, studentName,
          academicYear: plan.academic_year ?? '—', received, outstanding: b.amount,
          bucketLabel: b.label, bucketSortKey: b.sortKey, bucketStart: b.startDate,
        })
      }
    }

    setRawStudents(studentsData || [])
    setAllPlans(plans)
    setAllPayments(payments)
    setAllSchedules(schedules)
    setOutstandingSemesterRows(outstandingSemester)
    setOutstandingMonthRows(outstandingMonth)
    setLoading(false)
  }, [supabase, withRetry])

  /* eslint-disable react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await */
  useEffect(() => {
    loadData()
  }, [loadData])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Completely independent of loadData on purpose — some networks block
  // requests to the sola_sync_* tables outright ("TypeError: Failed to
  // fetch"), the same class of issue documented on the tuition_payments
  // fetch above. This badge is a nice-to-have; it must never be able to take
  // the whole page down if it fails, so it gets its own effect, its own
  // state, and swallows any error rather than surfacing one.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: syncCustomers } = await supabase
          .from('sola_sync_customers').select('id,matched_student_id').not('matched_student_id', 'is', null)
        const studentByCustomerId = new Map((syncCustomers ?? []).map(c => [c.id, c.matched_student_id as string]))
        const customerIds = (syncCustomers ?? []).map(c => c.id)
        if (!customerIds.length) return
        const { data: pending } = await supabase
          .from('sola_sync_payments').select('sola_sync_customer_id,amount')
          .in('sola_sync_customer_id', customerIds).in('import_status', ['pending', 'needs_review']).eq('gateway_status', 'Approved')
        const map = new Map<string, { count: number; total: number }>()
        for (const p of pending ?? []) {
          const studentId = studentByCustomerId.get(p.sola_sync_customer_id)
          if (!studentId) continue
          const cur = map.get(studentId) ?? { count: 0, total: 0 }
          cur.count++; cur.total += Number(p.amount ?? 0)
          map.set(studentId, cur)
        }
        if (!cancelled) setPendingSola(map)
      } catch {
        // Best-effort — leave the badge showing nothing rather than blocking
        // or erroring the page over a request some networks can't complete.
      }
    })()
    return () => { cancelled = true }
  }, [supabase])

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

    // Best-effort — Sola client sync shouldn't block the student record from being created.
    fetch('/api/sola/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'student', id: data.id }),
    }).catch(err => console.warn('Sola customer sync failed:', err))

    router.push(`/admin/tuition/${data.id}`)
  }

  const currentYear = useMemo(() => currentSchoolYear(), [])
  const periodYears = useMemo(() => selectableYears(allPlans.map(p => p.academic_year ?? '')), [allPlans])

  const paidByPlan = useMemo(() => {
    const map = new Map<string, number>()
    for (const pay of allPayments) map.set(pay.tuition_plan_id, (map.get(pay.tuition_plan_id) ?? 0) + Number(pay.amount))
    return map
  }, [allPayments])
  const plansByStudent = useMemo(() => {
    const map = new Map<string, TuitionPlan[]>()
    for (const p of allPlans) map.set(p.student_id, [...(map.get(p.student_id) ?? []), p])
    return map
  }, [allPlans])

  const students = useMemo(() => {
    const schedulesByStudent = new Map<string, ActiveSchedule[]>()
    for (const sch of allSchedules) {
      schedulesByStudent.set(sch.student_id, [...(schedulesByStudent.get(sch.student_id) ?? []), {
        id: sch.id, purpose: sch.purpose, amount: Number(sch.amount),
        intervalType: sch.interval_type, intervalCount: sch.interval_count,
        totalPayments: sch.total_payments, paymentMethodId: sch.payment_method_id,
      }])
    }
    return rawStudents
      .map(s => studentForPeriod(s, plansByStudent.get(s.id) ?? [], paidByPlan, schedulesByStudent.get(s.id) ?? [], period, currentYear))
      .filter((s): s is StudentWithTuition => s !== null)
  }, [rawStudents, plansByStudent, paidByPlan, allSchedules, period, currentYear])

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
    const matchesRecurring =
      recurringFilter === 'all' ||
      (recurringFilter === 'has_recurring' && s.activeSchedules.length > 0) ||
      (recurringFilter === 'no_recurring' && s.activeSchedules.length === 0)
    return matchesSearch && matchesFilter && matchesEnrollment && matchesOutstanding && matchesRecurring
  }), [students, search, filterStatus, enrollmentFilter, showOutstandingOnly, recurringFilter])

  // Group by academic year. Under "All years" a student can have plans in
  // several years, so each of their plans gets its own row in its own year
  // (numbers for just that plan) rather than one combined all-years row.
  const byYear = useMemo(() => {
    const map = new Map<string, StudentWithTuition[]>()
    const add = (key: string, s: StudentWithTuition) => {
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    for (const s of filtered) {
      if (period.kind !== 'all' || !s.activePlan) { add(s.activePlan?.academic_year || 'No Plan', s); continue }
      for (const plan of plansByStudent.get(s.id) ?? []) {
        const perPlan = studentForPeriod(s, [plan], paidByPlan, s.activeSchedules, { kind: 'year', year: plan.academic_year ?? '' }, currentYear)
        if (perPlan) add(plan.academic_year || 'No Plan', perPlan)
      }
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === 'No Plan') return 1
      if (b === 'No Plan') return -1
      return b.localeCompare(a) // newest year first
    })
  }, [filtered, period, plansByStudent, paidByPlan, currentYear])

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

  // These views are already broken down by period, so the period picker
  // just narrows which semesters/months are shown.
  const periodRange = useMemo(() => periodDateRange(period), [period])
  const byOutstandingSemester = useMemo(
    () => groupOutstanding(outstandingSemesterRows, filteredStudentIds, periodRange),
    [outstandingSemesterRows, filteredStudentIds, periodRange]
  )
  const byOutstandingMonth = useMemo(
    () => groupOutstanding(outstandingMonthRows, filteredStudentIds, periodRange),
    [outstandingMonthRows, filteredStudentIds, periodRange]
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

      {/* Period picker — scopes the summary cards and the lists below */}
      <div className="flex items-center gap-3 flex-wrap">
        <PeriodSelect value={period} onChange={setPeriod} years={periodYears} />
        <p className="text-xs text-slate-400">
          {period.kind === 'all'
            ? 'Totals across every tuition plan on file.'
            : period.kind === 'semester'
              ? 'Each plan\'s estimated share for this semester — spread evenly over the plan\'s dates, with payments applied to the earliest semester first.'
              : `Totals for ${period.year} tuition plans.`}
        </p>
      </div>

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
          <select
            value={recurringFilter}
            onChange={e => setRecurringFilter(e.target.value as typeof recurringFilter)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Recurring: All</option>
            <option value="has_recurring">Has Recurring</option>
            <option value="no_recurring">No Recurring</option>
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
        <TuitionTable students={filtered} pendingSola={pendingSola} onDataChanged={loadData} />
      ) : tab === 'semester_due' || tab === 'month_due' ? (
        <div className="space-y-5">
          <p className="text-xs text-slate-400 italic">
            Received is actual payments logged in that period. Outstanding is an estimate — plans aren&apos;t billed
            with a fixed schedule, so each plan&apos;s total is spread evenly across its date range and payments are
            applied to the oldest period first. Currently-enrolled students only.
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
                  Received <span className="text-green-600 font-medium">{formatCurrency(group.rows.reduce((sum, r) => sum + r.received, 0))}</span>
                  {' '}· Outstanding{' '}
                  <span className="text-red-600 font-medium">
                    {formatCurrency(group.rows.reduce((sum, r) => sum + r.outstanding, 0))}
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
                <TuitionTable students={group} pendingSola={pendingSola} onDataChanged={loadData} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TuitionTable({ students, pendingSola, onDataChanged }: { students: StudentWithTuition[]; pendingSola: Map<string, { count: number; total: number }>; onDataChanged: () => void }) {
  const supabase = createClient()
  const router = useRouter()
  const [manageStudentId, setManageStudentId] = useState<string | null>(null)
  const [manageSavedMethods, setManageSavedMethods] = useState<{ id: string; label: string }[]>([])

  // Saved payment methods are only needed once staff actually open the
  // "Update Card" step, not for every student on a list page that can have
  // dozens of rows — fetched on demand for just the one being managed.
  async function openManageRecurring(studentId: string) {
    setManageStudentId(studentId)
    const { data } = await supabase.from('payment_methods').select('id,label').eq('student_id', studentId)
    setManageSavedMethods((data ?? []).map(m => ({ id: m.id, label: m.label || 'Saved payment method' })))
  }

  const manageStudent = students.find(s => s.id === manageStudentId)

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
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
                      {currentGradeLevel(s.grade_level, s.came_semester)}{s.student_id && ` · ${s.student_id}`}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {s.activeSchedules.length > 0 && (
                        <button
                          onClick={e => { e.preventDefault(); e.stopPropagation(); openManageRecurring(s.id) }}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                          title={s.activeSchedules.map(scheduleSummary).join('\n')}
                        >
                          <Repeat size={11} />
                          {s.activeSchedules.map(sch => SCHEDULE_PURPOSE_LABEL[sch.purpose] ?? sch.purpose).join(', ')}
                        </button>
                      )}
                      <IncomingSolaBadge count={pendingSola.get(s.id)?.count ?? 0} total={pendingSola.get(s.id)?.total ?? 0} />
                    </div>
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
      </div>
      {students.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">No students found.</div>
      )}
      {manageStudent && (
        <ManageRecurringModal
          onClose={() => setManageStudentId(null)}
          type="student"
          schedules={manageStudent.activeSchedules.map(sch => ({
            id: sch.id, purpose: sch.purpose, amount: sch.amount,
            interval_type: sch.intervalType, interval_count: sch.intervalCount,
            total_payments: sch.totalPayments, payment_method_id: sch.paymentMethodId,
          }))}
          savedMethods={manageSavedMethods}
          onChanged={onDataChanged}
          // This list only has an aggregate balance per student (tuition +
          // building fund combined), not the per-purpose figure Recalculate
          // needs — computing that correctly means the same balance math the
          // detail page already does. Rather than risk recalculating off a
          // wrong number, hand off to the student's own tuition page, where
          // Recalculate has the real per-purpose balance to work with.
          onRecalculate={() => router.push(`/admin/tuition/${manageStudent.id}`)}
        />
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
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Received</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Outstanding</th>
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
              <td className="px-5 py-3 text-right text-sm text-green-600">
                {r.received > 0 ? formatCurrency(r.received) : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-5 py-3 text-right text-sm font-medium">
                {r.outstanding > 0 ? <span className="text-red-600">{formatCurrency(r.outstanding)}</span> : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">Nothing to show.</div>
      )}
    </div>
  )
}
