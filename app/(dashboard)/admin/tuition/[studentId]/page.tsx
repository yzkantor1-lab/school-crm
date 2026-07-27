'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft, GraduationCap, Plus, X, DollarSign, CheckCircle,
  Clock, AlertCircle, Edit2, Trash2, Bell, BellOff, CalendarRange, Printer, Receipt, Mail,
  Phone, MapPin
} from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import { SCHOOL_YEAR_SEMESTERS, studentDisplayStatus } from '@/lib/semesters'
import {
  generateTuitionBillPDF, generatePaymentReceiptPDF,
  getTuitionBillPdfBase64, getPaymentReceiptPdfBase64,
} from '@/lib/tuitionPdf'
import EmailPdfModal from '@/components/EmailPdfModal'
import SentLettersPanel from '@/components/SentLettersPanel'

type Student = {
  id: string
  first_name: string
  last_name: string
  grade_level: string | null
  student_id: string | null
  status: string
  came_semester: string | null
  semester_left: string | null
  address: string | null
  home_phone: string | null
  father_name: string | null
  father_cell: string | null
  father_email: string | null
  mother_name: string | null
  mother_cell: string | null
  mother_email: string | null
  parents_title: string | null
  registration_fee_status: 'pending' | 'paid' | 'waived' | null
  registration_fee_amount: number | null
  registration_fee_paid_date: string | null
}

type TuitionPlan = {
  id: string
  student_id: string
  academic_year: string
  total_amount: number
  payment_structure: string
  payment_structure_custom: string | null
  payment_amount: number
  payment_day: number | null
  start_date: string
  end_date: string
  status: string
  discount_amount: number
  building_fund_amount: number | null
  building_fund_waived: boolean
  notes: string | null
  preferred_payment_method: string | null
  reminder_date: string | null
  reminder_note: string | null
  yearly_amount: number | null
  plan_came_semester: string | null   // '1' | '2' | '3'
  plan_left_semester: string | null   // '1' | '2' | '3' | null = full year
  created_at: string
}

type TuitionPayment = {
  id: string
  tuition_plan_id: string
  student_id: string
  amount: number
  payment_date: string | null
  due_date: string | null
  status: string
  payment_method: string | null
  payment_type: string | null
  transaction_id: string | null
  notes: string | null
  created_at: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'credit_card',   label: 'Credit Card' },
  { value: 'zelle',         label: 'Zelle' },
  { value: 'check',         label: 'Check' },
  { value: 'cash',          label: 'Cash' },
  { value: 'venmo',         label: 'Venmo' },
  { value: 'paypal',        label: 'PayPal' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'wire_transfer', label: 'Wire Transfer' },
  { value: 'money_order',   label: 'Money Order' },
  { value: 'other',         label: 'Other' },
]

const PAYMENT_STRUCTURES = ['monthly', 'quarterly', 'semester', 'annual', 'custom']

function structureLabel(plan: Pick<TuitionPlan, 'payment_structure' | 'payment_structure_custom'>) {
  if (plan.payment_structure === 'custom') return plan.payment_structure_custom || 'Custom'
  return plan.payment_structure
}
const STATUSES = ['pending', 'paid', 'overdue', 'waived'] as const

// Tuition and Building Fund are tracked as separate charges/balances that both
// count toward what the family owes; Donation payments don't reduce either.
function planBalances(plan: TuitionPlan, planPayments: TuitionPayment[]) {
  const netTuition = Number(plan.total_amount) - Number(plan.discount_amount)
  const buildingFund = plan.building_fund_waived ? 0 : Number(plan.building_fund_amount ?? 0)
  const tuitionPaid = planPayments
    .filter(p => p.status === 'paid' && (p.payment_type ?? 'tuition') === 'tuition')
    .reduce((s, p) => s + Number(p.amount), 0)
  const buildingFundPaid = planPayments
    .filter(p => p.status === 'paid' && p.payment_type === 'building_fund')
    .reduce((s, p) => s + Number(p.amount), 0)
  const tuitionBalance = netTuition - tuitionPaid
  const buildingFundBalance = buildingFund - buildingFundPaid
  return {
    netTuition, buildingFund, tuitionPaid, buildingFundPaid, tuitionBalance, buildingFundBalance,
    totalPaid: tuitionPaid + buildingFundPaid,
    totalCharges: netTuition + buildingFund,
    totalBalance: tuitionBalance + buildingFundBalance,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function paymentMethodLabel(v: string | null) {
  if (!v) return '—'
  return PAYMENT_METHODS.find(m => m.value === v)?.label ?? v.replace(/_/g, ' ')
}

function reminderStatus(dateStr: string | null): 'none' | 'future' | 'soon' | 'today' | 'overdue' {
  if (!dateStr) return 'none'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000)
  if (diff < 0)   return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= 3)  return 'soon'
  return 'future'
}

function getYearGroup(academicYear: string) {
  return SCHOOL_YEAR_SEMESTERS.find(
    g => g.year === academicYear || g.year.replace('–', '-') === academicYear?.replace('–', '-')
  )
}

function isSemesterStartDate(date: string, yearGroup?: ReturnType<typeof getYearGroup>): boolean {
  return !!date && !!yearGroup && yearGroup.semesters.some(s => s.startDate === date)
}

type ProratedResult = {
  count: number
  semAmounts: [number, number, number]   // tuition share per semester, proportional to days
  semDays: [number, number, number]      // calendar days in each semester
  totalDays: number
  owed: number                           // sum of enrolled semesters' shares
  came: number                           // 1-based
  left: number                           // 1-based
}

// Divides yearly tuition proportionally by calendar days in each semester.
// Semester 2 (winter) is much longer than Elul, so it carries a larger share.
function proratedInfo(
  yearlyAmount: number | null,
  cameSem: string,
  leftSem: string,
  yearGroup?: ReturnType<typeof getYearGroup>,
): ProratedResult | null {
  if (!yearlyAmount) return null
  const came = Math.max(1, Math.min(3, parseInt(cameSem || '1') || 1))
  const left = Math.max(came, Math.min(3, parseInt(leftSem || '3') || 3))

  let semDays: [number, number, number]
  if (yearGroup) {
    semDays = yearGroup.semesters.map(s => {
      const ms = new Date(s.endDate + 'T00:00:00').getTime() - new Date(s.startDate + 'T00:00:00').getTime()
      return Math.max(1, Math.round(ms / 86400000))
    }) as [number, number, number]
  } else {
    semDays = [39, 148, 88]   // typical year fallback
  }

  const totalDays = semDays[0] + semDays[1] + semDays[2]
  const semAmounts: [number, number, number] = [
    (semDays[0] / totalDays) * yearlyAmount,
    (semDays[1] / totalDays) * yearlyAmount,
    (semDays[2] / totalDays) * yearlyAmount,
  ]

  let owed = 0
  for (let i = came - 1; i <= left - 1; i++) owed += semAmounts[i]

  return { count: left - came + 1, semAmounts, semDays, totalDays, owed, came, left }
}

function semesterShortLabel(num: string, yearGroup: ReturnType<typeof getYearGroup>) {
  if (!yearGroup) return `Semester ${num}`
  const idx = parseInt(num) - 1
  const s = yearGroup.semesters[idx]
  if (!s) return `Semester ${num}`
  const start = new Date(s.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const end   = new Date(s.endDate   + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `Sem ${num} (${start} – ${end})`
}

// Extracts the "1", "2", or "3" from a semester value like "2025–2026 Semester 2"
function extractSemNum(value: string | null | undefined): string {
  if (!value) return '1'
  const m = value.match(/Semester (\d)/)
  return m ? m[1] : '1'
}

// Extracts "YYYY–YYYY" from a semester value
function extractYearFromSemester(value: string | null | undefined): string {
  if (!value) return ''
  const m = value.match(/^(\d{4}[–\-]\d{4})/)
  return m ? m[1] : ''
}

// Month-by-month tuition breakdown for enrolled semesters
type MonthEntry = { label: string; shortLabel: string; semester: number; days: number; amount: number }

function monthlyBreakdown(
  yearlyAmount: number,
  yearGroup: ReturnType<typeof getYearGroup>,
  cameSem: number,
  leftSem: number,
): MonthEntry[] {
  if (!yearGroup) return []
  const totalDays = yearGroup.semesters.reduce((sum, s) => {
    return sum + Math.max(1, Math.round(
      (new Date(s.endDate + 'T00:00:00').getTime() - new Date(s.startDate + 'T00:00:00').getTime()) / 86400000
    ))
  }, 0)
  const entries: MonthEntry[] = []
  for (let semIdx = 0; semIdx < 3; semIdx++) {
    const semNum = semIdx + 1
    if (semNum < cameSem || semNum > leftSem) continue
    const sem = yearGroup.semesters[semIdx]
    const end = new Date(sem.endDate + 'T00:00:00')
    let cur = new Date(sem.startDate + 'T00:00:00')
    while (cur < end) {
      const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
      const periodEnd = nextMonth < end ? nextMonth : end
      const days = Math.round((periodEnd.getTime() - cur.getTime()) / 86400000)
      entries.push({
        label: cur.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        shortLabel: cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        semester: semNum,
        days,
        amount: (days / totalDays) * yearlyAmount,
      })
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
  }
  return entries
}

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    overdue: 'bg-red-100 text-red-700',
    waived: 'bg-slate-100 text-slate-600',
    active: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
  }
  return map[status] ?? 'bg-slate-100 text-slate-600'
}

const planStatusIcon = (status: string) => {
  if (status === 'paid')    return <CheckCircle size={14} className="text-green-600" />
  if (status === 'overdue') return <AlertCircle size={14} className="text-red-600" />
  return <Clock size={14} className="text-yellow-600" />
}

// ── Yearly Overview sub-component ────────────────────────────────────────────

function YearlyOverview({
  plan,
  payments,
}: {
  plan: TuitionPlan
  payments: TuitionPayment[]
}) {
  const yearGroup = getYearGroup(plan.academic_year)
  if (!yearGroup || !plan.yearly_amount) return null

  const info = proratedInfo(
    plan.yearly_amount,
    plan.plan_came_semester || '1',
    plan.plan_left_semester || '3',
    yearGroup,
  )
  if (!info) return null

  const totalPaid = payments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0)

  function paymentsInSem(semIdx: number) {
    const sem = yearGroup!.semesters[semIdx]
    if (!sem) return []
    const start = new Date(sem.startDate + 'T00:00:00').getTime()
    const end   = new Date(sem.endDate   + 'T23:59:59').getTime()
    return payments.filter(p => {
      const dateStr = p.payment_date || p.due_date
      if (!dateStr) return false
      const d = new Date(dateStr + 'T00:00:00').getTime()
      return d >= start && d <= end
    })
  }

  return (
    <div className="mb-5 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white">
        <CalendarRange size={15} className="text-blue-500" />
        <p className="text-sm font-semibold text-slate-800">Yearly Overview — {plan.academic_year}</p>
        <span className="text-xs text-slate-400 ml-auto">
          Annual rate: {formatCurrency(plan.yearly_amount)} · {info.totalDays} school days total · divided by semester length
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Semester</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Dates</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Days</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Share</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Tuition Owed</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Paid</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-100">
            {yearGroup.semesters.map((sem, i) => {
              const semNum   = i + 1
              const enrolled = semNum >= info.came && semNum <= info.left
              const days     = info.semDays[i]
              const share    = ((days / info.totalDays) * 100).toFixed(1)
              const amount   = info.semAmounts[i]
              const semPays  = paymentsInSem(i)
              const semPaid  = semPays.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0)
              const startFmt = new Date(sem.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              const endFmt   = new Date(sem.endDate   + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

              return (
                <tr key={i} className={enrolled ? '' : 'opacity-40 bg-slate-50'}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">Semester {semNum}</span>
                    {enrolled && (
                      <span className="ml-2 inline-flex items-center text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">enrolled</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{startFmt} – {endFmt}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">{days}d</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">{share}%</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">
                    {enrolled ? formatCurrency(amount) : <span className="text-slate-300 font-normal">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-green-600 font-medium">
                    {enrolled ? (semPaid > 0 ? formatCurrency(semPaid) : <span className="text-slate-300 font-normal">—</span>) : null}
                  </td>
                  <td className="px-4 py-3">
                    {enrolled && (
                      semPaid >= amount
                        ? <span className="text-xs text-green-600 font-medium">Paid in full</span>
                        : semPaid > 0
                          ? <span className="text-xs text-amber-600 font-medium">{formatCurrency(amount - semPaid)} remaining</span>
                          : <span className="text-xs text-red-500 font-medium">Unpaid</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-4 py-3 text-sm text-slate-700" colSpan={4}>
                Total ({info.count} of 3 semesters)
              </td>
              <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(info.owed)}</td>
              <td className="px-4 py-3 text-right text-green-700">{formatCurrency(totalPaid)}</td>
              <td className="px-4 py-3">
                {info.owed > 0 && (
                  <span className={`text-xs font-semibold ${totalPaid >= info.owed ? 'text-green-600' : 'text-red-600'}`}>
                    {totalPaid >= info.owed ? 'Paid in Full' : `${formatCurrency(info.owed - totalPaid)} remaining`}
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Month-by-month breakdown */}
      {(() => {
        const months = monthlyBreakdown(plan.yearly_amount!, yearGroup, info.came, info.left)
        if (!months.length) return null
        const SEM_COLORS = ['bg-violet-50 border-violet-200', 'bg-blue-50 border-blue-200', 'bg-emerald-50 border-emerald-200']
        const SEM_LABELS = ['Sem 1 · Elul', 'Sem 2 · Winter', 'Sem 3 · Summer']
        // group by semester
        const bySem: MonthEntry[][] = [[], [], []]
        months.forEach(m => bySem[m.semester - 1].push(m))
        return (
          <div className="border-t border-slate-200">
            <div className="px-4 py-3 bg-slate-50 flex items-center gap-2">
              <CalendarRange size={14} className="text-slate-500" />
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Month-by-Month Breakdown</p>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {bySem.map((semMonths, si) => {
                if (!semMonths.length) return null
                const semTotal = semMonths.reduce((s, m) => s + m.amount, 0)
                return (
                  <div key={si} className={`rounded-xl border p-3 ${SEM_COLORS[si]}`}>
                    <p className="text-xs font-semibold text-slate-600 mb-2">{SEM_LABELS[si]}</p>
                    <div className="space-y-1.5">
                      {semMonths.map((m, mi) => (
                        <div key={mi} className="flex items-center justify-between">
                          <span className="text-xs text-slate-600">{m.label}</span>
                          <div className="text-right">
                            <span className="text-xs font-semibold text-slate-800">{formatCurrency(m.amount)}</span>
                            <span className="text-xs text-slate-400 ml-1">({m.days}d)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 pt-2 border-t border-current border-opacity-20 flex justify-between">
                      <span className="text-xs font-medium text-slate-500">Semester total</span>
                      <span className="text-xs font-bold text-slate-800">{formatCurrency(semTotal)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const BLANK_PLAN_FORM = {
  academic_year: '',
  total_amount: '',
  payment_structure: 'monthly',
  payment_structure_custom: '',
  payment_amount: '',
  payment_day: '',
  start_date: '',
  end_date: '',
  discount_amount: '0',
  building_fund_amount: '750',
  building_fund_waived: false,
  notes: '',
  status: 'active',
  preferred_payment_method: '',
  reminder_date: '',
  reminder_note: '',
  yearly_amount: '',
  plan_came_semester: '1',
  plan_left_semester: '3',
}

export default function StudentTuitionPage() {
  const { studentId } = useParams<{ studentId: string }>()
  const supabase = createClient()

  const [student, setStudent]   = useState<Student | null>(null)
  const [plans, setPlans]       = useState<TuitionPlan[]>([])
  const [payments, setPayments] = useState<TuitionPayment[]>([])
  const [emailModal, setEmailModal] = useState<{
    defaultRecipients: string[]
    defaultSubject: string
    defaultBody: string
    buildAttachment: () => Promise<{ filename: string; base64: string }>
  } | null>(null)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null)

  const [showAddPlan, setShowAddPlan]   = useState(false)
  const [planForm, setPlanForm]         = useState({ ...BLANK_PLAN_FORM })
  const [editingPlan, setEditingPlan]   = useState<TuitionPlan | null>(null)
  const [savingPlan, setSavingPlan]     = useState(false)
  const [leavingMidYear, setLeavingMidYear] = useState(false)
  const [customStartDate, setCustomStartDate] = useState(false)

  const [showAddPayment, setShowAddPayment]   = useState<string | null>(null)
  const [paymentForm, setPaymentForm]         = useState({ amount: '', due_date: '', payment_date: '', status: 'pending', payment_method: '', payment_type: 'tuition', transaction_id: '', notes: '' })
  const [editingPayment, setEditingPayment]   = useState<TuitionPayment | null>(null)
  const [savingPayment, setSavingPayment]     = useState(false)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const [{ data: s }, { data: p }, { data: pay }] = await Promise.all([
        supabase.from('students').select('id,first_name,last_name,grade_level,student_id,status,came_semester,semester_left,address,home_phone,father_name,father_cell,father_email,mother_name,mother_cell,mother_email,parents_title,registration_fee_status,registration_fee_amount,registration_fee_paid_date').eq('id', studentId).single(),
        supabase.from('tuition_plans').select('*').eq('student_id', studentId).order('created_at', { ascending: false }),
        supabase.from('tuition_payments').select('*').eq('student_id', studentId).order('due_date'),
      ])
      setStudent(s)
      setPlans(p || [])
      setPayments(pay || [])
    } catch {
      // Network-level fetch failure (flaky connection, ad blocker) that
      // survived the Supabase client's own retries — surface a retry
      // affordance instead of leaving an unhandled console error.
      setLoadError(true)
    }
    setLoading(false)
  }, [studentId, supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await
  useEffect(() => { load() }, [load])

  // Registration fee is a flat one-time charge, not paid incrementally like
  // tuition/building fund — so these are direct one-click status changes
  // rather than routing through the detailed Add Payment flow.
  async function setRegistrationFee(fields: Partial<Pick<Student, 'registration_fee_status' | 'registration_fee_amount' | 'registration_fee_paid_date'>>) {
    if (!student) return
    setStudent({ ...student, ...fields })
    await supabase.from('students').update(fields).eq('id', studentId)
  }
  const addRegistrationFee = () => setRegistrationFee({ registration_fee_status: 'pending', registration_fee_amount: 250, registration_fee_paid_date: null })
  const markRegistrationFeePaid = () => setRegistrationFee({ registration_fee_status: 'paid', registration_fee_paid_date: new Date().toISOString().slice(0, 10) })
  const waiveRegistrationFee = () => setRegistrationFee({ registration_fee_status: 'waived', registration_fee_paid_date: null })
  const resetRegistrationFee = () => setRegistrationFee({ registration_fee_status: 'pending', registration_fee_paid_date: null })

  // Year group for the form's academic year (drives semester labels + day-proportional billing)
  const formYearGroup = useMemo(
    () => getYearGroup(planForm.academic_year),
    [planForm.academic_year]
  )

  // Live prorated calculation from form — uses calendar days from the selected year group
  const formProrated = useMemo(
    () => proratedInfo(
      planForm.yearly_amount ? parseFloat(planForm.yearly_amount) : null,
      planForm.plan_came_semester,
      planForm.plan_left_semester,
      formYearGroup,
    ),
    [planForm.yearly_amount, planForm.plan_came_semester, planForm.plan_left_semester, formYearGroup]
  )

  // Keep total_amount in sync with prorated owed whenever yearly billing changes.
  // Intentional effect: total_amount stays a user-editable field, auto-filled here
  // whenever the inputs driving proration change, but overridable afterward.
  useEffect(() => {
    if (formProrated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs a derived value into editable form state, see comment above
      setPlanForm(f => ({ ...f, total_amount: formProrated.owed.toFixed(2) }))
    }
  }, [formProrated])

  function onAcademicYearChange(year: string) {
    const yg = getYearGroup(year)
    if (!yg) { setPlanForm(f => ({ ...f, academic_year: year })); return }

    // Auto-detect: if this academic year matches the student's came_semester year, use their semester
    const studentCameYear = extractYearFromSemester(student?.came_semester)
    const normalise = (s: string) => s.replace('–', '-')
    const isFirstYear = !!studentCameYear && normalise(studentCameYear) === normalise(year)
    const cameSemNum  = isFirstYear ? extractSemNum(student?.came_semester) : '1'

    const cameSemIdx = parseInt(cameSemNum) - 1
    const startDate  = yg.semesters[cameSemIdx]?.startDate || ''
    const endDate    = yg.semesters[2]?.endDate || ''

    setPlanForm(f => ({
      ...f,
      academic_year: year,
      plan_came_semester: cameSemNum,
      plan_left_semester: '3',
      // Only auto-set start_date to the semester start when not using a custom date
      start_date: customStartDate ? f.start_date : startDate,
      // Only auto-set end_date for graduating students or when mid-year leaving is toggled
      end_date: (student?.status === 'graduated' || leavingMidYear) ? endDate : '',
    }))
  }

  function openAddPlan() {
    setEditingPlan(null)
    setLeavingMidYear(false)
    setCustomStartDate(false)
    const cameYear  = extractYearFromSemester(student?.came_semester)
    const base      = { ...BLANK_PLAN_FORM, plan_came_semester: '1', plan_left_semester: '3' }
    if (cameYear) {
      const yg         = getYearGroup(cameYear)
      const cameSemNum = extractSemNum(student?.came_semester)
      const cameSemIdx = parseInt(cameSemNum) - 1
      Object.assign(base, {
        academic_year: cameYear,
        plan_came_semester: cameSemNum,
        start_date: yg?.semesters[cameSemIdx]?.startDate || '',
        // end_date only set if student is graduated
        end_date: student?.status === 'graduated' ? (yg?.semesters[2]?.endDate || '') : '',
      })
    }
    setPlanForm(base)
    setShowAddPlan(true)
  }

  function openEditPlan(plan: TuitionPlan) {
    setEditingPlan(plan)
    // Show leaving fields if plan already has a mid-year departure or student is graduated
    setLeavingMidYear(
      student?.status === 'graduated' ||
      (!!plan.plan_left_semester && plan.plan_left_semester !== '3') ||
      !!plan.end_date
    )
    setCustomStartDate(!isSemesterStartDate(plan.start_date, getYearGroup(plan.academic_year)))
    setPlanForm({
      academic_year: plan.academic_year ?? '',
      total_amount: String(plan.total_amount ?? ''),
      payment_structure: plan.payment_structure ?? 'monthly',
      payment_structure_custom: plan.payment_structure_custom || '',
      payment_amount: String(plan.payment_amount ?? ''),
      payment_day: plan.payment_day ? String(plan.payment_day) : '',
      start_date: plan.start_date ?? '',
      end_date: plan.end_date ?? '',
      discount_amount: String(plan.discount_amount ?? 0),
      building_fund_amount: String(plan.building_fund_amount ?? 0),
      building_fund_waived: !!plan.building_fund_waived,
      notes: plan.notes || '',
      status: plan.status ?? 'active',
      preferred_payment_method: plan.preferred_payment_method || '',
      reminder_date: plan.reminder_date || '',
      reminder_note: plan.reminder_note || '',
      yearly_amount: plan.yearly_amount ? String(plan.yearly_amount) : '',
      plan_came_semester: plan.plan_came_semester || '1',
      plan_left_semester: plan.plan_left_semester || '3',
    })
    setShowAddPlan(true)
  }

  async function savePlan(e: React.FormEvent) {
    e.preventDefault()
    if (planForm.payment_structure === 'annual' && !formProrated) {
      alert('For an Annual payment structure, enter the Annual Tuition Rate (and the semester the student started) in the Yearly Billing section above — the total owed is calculated from that, not typed in directly.')
      return
    }
    setSavingPlan(true)
    const toNum = (v: string) => v !== '' ? parseFloat(v) : null
    const payload = {
      student_id: studentId,
      academic_year: planForm.academic_year || null,
      total_amount: formProrated ? formProrated.owed : toNum(planForm.total_amount),
      payment_structure: planForm.payment_structure || null,
      payment_structure_custom: planForm.payment_structure === 'custom' ? (planForm.payment_structure_custom || null) : null,
      payment_amount: toNum(planForm.payment_amount),
      payment_day: planForm.payment_day ? parseInt(planForm.payment_day) : null,
      start_date: planForm.start_date || null,
      end_date: planForm.end_date || null,
      discount_amount: toNum(planForm.discount_amount) ?? 0,
      building_fund_amount: toNum(planForm.building_fund_amount) ?? 0,
      building_fund_waived: planForm.building_fund_waived,
      notes: planForm.notes || null,
      status: planForm.status,
      preferred_payment_method: planForm.preferred_payment_method || null,
      reminder_date: planForm.reminder_date || null,
      reminder_note: planForm.reminder_note || null,
      yearly_amount: toNum(planForm.yearly_amount),
      plan_came_semester: planForm.plan_came_semester || null,
      plan_left_semester: planForm.plan_left_semester || null,
    }
    if (editingPlan) {
      await supabase.from('tuition_plans').update(payload).eq('id', editingPlan.id)
    } else {
      await supabase.from('tuition_plans').insert([payload])
    }
    setSavingPlan(false)
    setShowAddPlan(false)
    load()
  }

  async function deletePlan(id: string) {
    if (!confirm('Delete this tuition plan and all its payments? This cannot be undone.')) return
    await supabase.from('tuition_plans').delete().eq('id', id)
    load()
  }

  function openAddPayment(planId: string) {
    setEditingPayment(null)
    setPaymentForm({ amount: '', due_date: '', payment_date: '', status: 'pending', payment_method: '', payment_type: 'tuition', transaction_id: '', notes: '' })
    setExpandedPlan(planId)
    setShowAddPayment(planId)
  }

  function openEditPayment(payment: TuitionPayment) {
    setEditingPayment(payment)
    setPaymentForm({
      amount: String(payment.amount),
      due_date: payment.due_date || '',
      payment_date: payment.payment_date || '',
      status: payment.status,
      payment_method: payment.payment_method || '',
      payment_type: payment.payment_type || 'tuition',
      transaction_id: payment.transaction_id || '',
      notes: payment.notes || '',
    })
    setShowAddPayment(payment.tuition_plan_id)
  }

  async function savePayment(e: React.FormEvent) {
    e.preventDefault()
    if (!showAddPayment) return
    setSavingPayment(true)
    const payload = {
      tuition_plan_id: showAddPayment,
      student_id: studentId,
      amount: paymentForm.amount !== '' ? parseFloat(paymentForm.amount) : null,
      due_date: paymentForm.due_date || null,
      payment_date: paymentForm.payment_date || null,
      status: paymentForm.status,
      payment_method: paymentForm.payment_method || null,
      payment_type: paymentForm.payment_type || 'tuition',
      transaction_id: paymentForm.transaction_id || null,
      notes: paymentForm.notes || null,
    }
    if (editingPayment) {
      await supabase.from('tuition_payments').update(payload).eq('id', editingPayment.id)
    } else {
      await supabase.from('tuition_payments').insert([payload])
    }
    setSavingPayment(false)
    setShowAddPayment(null)
    load()
  }

  async function deletePayment(id: string) {
    if (!confirm('Delete this payment record?')) return
    await supabase.from('tuition_payments').delete().eq('id', id)
    load()
  }

  function billArgs(plan: TuitionPlan, planPayments: TuitionPayment[], extraNote?: string) {
    const yearGroup = getYearGroup(plan.academic_year)
    const prorated = proratedInfo(plan.yearly_amount, plan.plan_came_semester || '1', plan.plan_left_semester || '3', yearGroup)
    const semesterRows = prorated && yearGroup
      ? yearGroup.semesters
          .map((sem, i) => ({
            label: `Semester ${i + 1}`,
            dates: `${new Date(sem.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(sem.endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
            amount: prorated.semAmounts[i],
            enrolled: i + 1 >= prorated.came && i + 1 <= prorated.left,
          }))
          .filter(r => r.enrolled)
      : undefined

    return {
      student: student!,
      plan,
      payments: planPayments,
      semesterRows,
      paymentMethodLabel,
      extraNote,
    }
  }

  function receiptArgs(plan: TuitionPlan, payment: TuitionPayment, extraNote?: string) {
    const planPayments = payments.filter(p => p.tuition_plan_id === plan.id)
    const bal = planBalances(plan, planPayments)
    const balanceAfter = payment.payment_type === 'building_fund' ? bal.buildingFundBalance : bal.tuitionBalance

    return {
      student: student!,
      plan,
      payment,
      balanceAfter,
      paymentMethodLabel,
      extraNote,
    }
  }

  function printBill(plan: TuitionPlan, planPayments: TuitionPayment[]) {
    if (!student) return
    const note = prompt('Add a note to this statement? (optional)') || undefined
    generateTuitionBillPDF(billArgs(plan, planPayments, note))
  }

  function printReceipt(plan: TuitionPlan, payment: TuitionPayment) {
    if (!student) return
    const note = prompt('Add a note to this receipt? (optional)') || undefined
    generatePaymentReceiptPDF(receiptArgs(plan, payment, note))
  }

  function emailBill(plan: TuitionPlan, planPayments: TuitionPayment[]) {
    if (!student) return
    const note = prompt('Add a note to this statement? (optional)') || undefined
    const bal = planBalances(plan, planPayments)
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ')
    setEmailModal({
      defaultRecipients: [student.father_email, student.mother_email].filter((e): e is string => !!e),
      defaultSubject: `Tuition Statement — ${name} (${plan.academic_year})`,
      defaultBody: `Hi,\n\nPlease find attached the tuition statement for ${name} — ${plan.academic_year}.\n\nBalance due: ${bal.totalBalance > 0 ? formatCurrency(bal.totalBalance) : 'Paid in full'}.\n\nThank you.`,
      buildAttachment: () => getTuitionBillPdfBase64(billArgs(plan, planPayments, note)),
    })
  }

  function emailReceipt(plan: TuitionPlan, payment: TuitionPayment) {
    if (!student) return
    const note = prompt('Add a note to this receipt? (optional)') || undefined
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ')
    const typeLabel = payment.payment_type === 'donation' ? 'Donation' : payment.payment_type === 'building_fund' ? 'Building Fund' : 'Payment'
    setEmailModal({
      defaultRecipients: [student.father_email, student.mother_email].filter((e): e is string => !!e),
      defaultSubject: `${typeLabel} Receipt — ${name}`,
      defaultBody: `Hi,\n\nPlease find attached your receipt for the ${typeLabel.toLowerCase()} of ${formatCurrency(Number(payment.amount))}.\n\nThank you.`,
      buildAttachment: () => getPaymentReceiptPdfBase64(receiptArgs(plan, payment, note)),
    })
  }

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
  if (loadError) return (
    <div className="text-center py-12 text-sm space-y-3">
      <p className="text-slate-400">Couldn&apos;t load this page. Check your connection and try again.</p>
      <button onClick={() => { setLoading(true); load() }}
        className="text-blue-600 hover:text-blue-700 font-medium px-4 py-2 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors">
        Retry
      </button>
    </div>
  )
  if (!student) return <div className="text-center py-12 text-slate-400 text-sm">Student not found.</div>

  return (
    <div className="max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <Link href="/admin/tuition" className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm transition-colors">
          <ArrowLeft size={15} />
          Tuition
        </Link>
        <span className="text-slate-300">/</span>
        <Link href={`/admin/students/${studentId}`} className="text-slate-500 hover:text-slate-700 text-sm transition-colors">
          {student.first_name} {student.last_name}
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-blue-100 p-2.5 rounded-xl">
            <GraduationCap size={22} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{student.first_name} {student.last_name}</h1>
            <p className="text-sm text-slate-500">
              {student.grade_level && `${student.grade_level}`}
              {student.student_id && ` · ID: ${student.student_id}`}
              {` · `}
              {(() => {
                const displayStatus = studentDisplayStatus(student.status, student.came_semester)
                return (
                  <span className={`capitalize ${displayStatus === 'active' ? 'text-green-600' : displayStatus === 'pending' ? 'text-amber-600' : 'text-slate-400'}`}>
                    {displayStatus}
                  </span>
                )
              })()}
              {student.came_semester && <span className="text-slate-400"> · Started: {student.came_semester}</span>}
            </p>
          </div>
        </div>
        <button
          onClick={openAddPlan}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Plan
        </button>
      </div>

      {/* Contact info — so there's no need to jump to the student file while working on tuition */}
      {(student.address || student.home_phone || student.father_name || student.father_cell || student.father_email
        || student.mother_name || student.mother_cell || student.mother_email) && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 grid sm:grid-cols-2 gap-4">
          {(student.address || student.home_phone) && (
            <div className="space-y-1">
              {student.parents_title && <p className="text-xs font-medium text-slate-400">{student.parents_title}</p>}
              {student.address && (
                <p className="flex items-start gap-1.5 text-sm text-slate-700">
                  <MapPin size={14} className="text-slate-400 mt-0.5 shrink-0" /> {student.address}
                </p>
              )}
              {student.home_phone && (
                <p className="flex items-center gap-1.5 text-sm text-slate-700">
                  <Phone size={14} className="text-slate-400 shrink-0" /> {student.home_phone}
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {(student.father_name || student.father_cell || student.father_email) && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-400">Father</p>
                {student.father_name && <p className="text-sm font-medium text-slate-900">{student.father_name}</p>}
                {student.father_cell && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Phone size={12} className="text-slate-400 shrink-0" /> {student.father_cell}
                  </p>
                )}
                {student.father_email && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-600 truncate">
                    <Mail size={12} className="text-slate-400 shrink-0" /> {student.father_email}
                  </p>
                )}
              </div>
            )}
            {(student.mother_name || student.mother_cell || student.mother_email) && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-400">Mother</p>
                {student.mother_name && <p className="text-sm font-medium text-slate-900">{student.mother_name}</p>}
                {student.mother_cell && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Phone size={12} className="text-slate-400 shrink-0" /> {student.mother_cell}
                  </p>
                )}
                {student.mother_email && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-600 truncate">
                    <Mail size={12} className="text-slate-400 shrink-0" /> {student.mother_email}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Registration Fee — one-time flat fee, tracked separately from tuition plans */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <Receipt size={16} className="text-slate-400 shrink-0" />
          <span className="text-sm font-medium text-slate-700">Registration Fee</span>
          {student.registration_fee_status === 'pending' && (
            <span className="text-sm text-amber-600 font-medium">{formatCurrency(Number(student.registration_fee_amount ?? 0))} · Pending</span>
          )}
          {student.registration_fee_status === 'paid' && (
            <span className="text-sm text-green-600 font-medium">
              {formatCurrency(Number(student.registration_fee_amount ?? 0))} · Paid
              {student.registration_fee_paid_date && ` on ${new Date(student.registration_fee_paid_date + 'T00:00:00').toLocaleDateString()}`}
            </span>
          )}
          {student.registration_fee_status === 'waived' && (
            <span className="text-sm text-slate-400 font-medium">Waived</span>
          )}
          {!student.registration_fee_status && (
            <span className="text-sm text-slate-400">Not on file</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!student.registration_fee_status && (
            <button onClick={addRegistrationFee}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
              <Plus size={13} /> Add $250 Registration Fee
            </button>
          )}
          {student.registration_fee_status === 'pending' && (
            <>
              <button onClick={markRegistrationFeePaid}
                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                <CheckCircle size={13} /> Mark Paid
              </button>
              <button onClick={waiveRegistrationFee}
                className="text-xs text-slate-500 hover:text-slate-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
                Waive
              </button>
            </>
          )}
          {(student.registration_fee_status === 'paid' || student.registration_fee_status === 'waived') && (
            <button onClick={resetRegistrationFee}
              className="text-xs text-slate-400 hover:text-slate-600 font-medium px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
              Undo
            </button>
          )}
        </div>
      </div>

      <SentLettersPanel studentId={studentId} />

      {/* Active reminders alert */}
      {plans.some(p => ['overdue','today','soon'].includes(reminderStatus(p.reminder_date))) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Bell size={15} className="text-amber-600" />
            <p className="text-sm font-semibold text-amber-900">Payment Reminders</p>
          </div>
          {plans
            .filter(p => ['overdue','today','soon'].includes(reminderStatus(p.reminder_date)))
            .map(p => {
              const rs      = reminderStatus(p.reminder_date)
              const balance = planBalances(p, payments.filter(pay => pay.tuition_plan_id === p.id)).totalBalance
              return (
                <div key={p.id} className="flex items-start gap-3 bg-white rounded-lg p-3 border border-amber-100">
                  <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${rs === 'overdue' ? 'bg-red-500' : rs === 'today' ? 'bg-orange-500' : 'bg-amber-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {p.academic_year}
                      {balance > 0 && <span className="ml-2 text-red-600 text-xs font-semibold">{formatCurrency(balance)} outstanding</span>}
                    </p>
                    {p.reminder_note && <p className="text-xs text-slate-500 mt-0.5">{p.reminder_note}</p>}
                    <p className="text-xs text-amber-700 mt-0.5">
                      {rs === 'overdue' ? `Overdue — was ${new Date(p.reminder_date! + 'T00:00:00').toLocaleDateString()}` :
                       rs === 'today'   ? 'Due today' :
                                          `Due ${new Date(p.reminder_date! + 'T00:00:00').toLocaleDateString()}`}
                    </p>
                  </div>
                  <button onClick={() => openEditPlan(p)} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex-shrink-0">Edit plan</button>
                </div>
              )
            })}
        </div>
      )}

      {/* ── Add / Edit plan form ───────────────────────────────────────────── */}
      {showAddPlan && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">{editingPlan ? 'Edit Tuition Plan' : 'New Tuition Plan'}</h2>
            <button onClick={() => setShowAddPlan(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>

          <form onSubmit={savePlan} className="space-y-5">

            {/* ── Section 1: Academic Year ────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">Academic Year</label>
                <select
                  value={planForm.academic_year}
                  onChange={e => onAcademicYearChange(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Select academic year —</option>
                  {SCHOOL_YEAR_SEMESTERS.map(({ year }) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                {planForm.academic_year && (() => {
                  const studentCameYear = extractYearFromSemester(student?.came_semester)
                  const normalise = (s: string) => s.replace('–', '-')
                  const isFirstYear = !!studentCameYear && normalise(studentCameYear) === normalise(planForm.academic_year)
                  if (isFirstYear) return (
                    <p className="text-xs text-blue-600 mt-1.5 flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
                      First year — automatically starting from <strong>Semester {planForm.plan_came_semester}</strong> based on enrollment record
                    </p>
                  )
                  return (
                    <p className="text-xs text-slate-400 mt-1.5">Full year plan (Sem 1 → Sem 3)</p>
                  )
                })()}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
                <select value={planForm.status} onChange={e => setPlanForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Start Date</label>
                {customStartDate ? (
                  <div className="space-y-1">
                    <input type="date" value={planForm.start_date} onChange={e => setPlanForm(f => ({ ...f, start_date: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button type="button" onClick={() => setCustomStartDate(false)}
                      className="text-xs text-slate-400 hover:text-red-500">Use semester start date</button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <select value={planForm.start_date}
                      onChange={e => setPlanForm(f => ({ ...f, start_date: e.target.value }))}
                      disabled={!formYearGroup}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400">
                      <option value="">{formYearGroup ? '— select start date —' : 'Select academic year first'}</option>
                      {formYearGroup?.semesters.map((s, i) => (
                        <option key={s.value} value={s.startDate}>{semesterShortLabel(String(i + 1), formYearGroup)}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setCustomStartDate(true)}
                      className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2">Custom start date →</button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Section 2: Yearly Billing ───────────────────────────────── */}
            <div className="border border-blue-100 bg-blue-50 rounded-xl p-4 space-y-4">
              <p className="text-sm font-semibold text-blue-900">Yearly Billing</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-blue-700 mb-1">Annual Tuition Rate (full year)</label>
                  <input type="number" step="0.01" min="0" value={planForm.yearly_amount}
                    onChange={e => setPlanForm(f => ({ ...f, yearly_amount: e.target.value }))}
                    placeholder="e.g. 18500"
                    className="w-full border border-blue-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-blue-700 mb-1">Student started this year in</label>
                  <select value={planForm.plan_came_semester}
                    onChange={e => setPlanForm(f => ({ ...f, plan_came_semester: e.target.value }))}
                    className="w-full border border-blue-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="1">{semesterShortLabel('1', formYearGroup)}</option>
                    <option value="2">{semesterShortLabel('2', formYearGroup)}</option>
                    <option value="3">{semesterShortLabel('3', formYearGroup)}</option>
                  </select>
                </div>
              </div>

              {/* Semester-by-semester breakdown with auto-calculated owed */}
              {formProrated && (
                <div className="bg-white rounded-xl border border-blue-200 overflow-hidden">
                  <div className="divide-y divide-slate-100">
                    {[1, 2, 3].map(n => {
                      const enrolled = n >= formProrated.came && n <= formProrated.left
                      const days     = formProrated.semDays[n - 1]
                      const share    = ((days / formProrated.totalDays) * 100).toFixed(1)
                      const amt      = formProrated.semAmounts[n - 1]
                      return (
                        <div key={n} className={`flex items-center justify-between px-4 py-2.5 ${enrolled ? '' : 'opacity-30'}`}>
                          <div className="flex items-center gap-2">
                            {enrolled
                              ? <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                              : <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />}
                            <span className="text-sm text-slate-700">Semester {n}</span>
                            <span className="text-xs text-slate-400">{days}d · {share}%</span>
                          </div>
                          <span className={`text-sm font-semibold ${enrolled ? 'text-slate-900' : 'text-slate-300'}`}>
                            {formatCurrency(amt)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 bg-blue-600">
                    <span className="text-sm font-semibold text-white">
                      {formProrated.came === 1
                        ? 'Full year owed'
                        : `Owed from Sem ${formProrated.came} (partial year)`}
                    </span>
                    <span className="text-base font-bold text-white">{formatCurrency(formProrated.owed)}</span>
                  </div>
                </div>
              )}

              {/* Leaving / graduating — only show for graduated students or when toggled */}
              {(student?.status === 'graduated' || leavingMidYear) ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      {student?.status === 'graduated' ? 'Graduation / Departure' : 'Mid-year departure'}
                    </p>
                    {student?.status !== 'graduated' && (
                      <button type="button" onClick={() => {
                        setLeavingMidYear(false)
                        setPlanForm(f => ({ ...f, plan_left_semester: '3', end_date: '' }))
                      }} className="text-xs text-slate-400 hover:text-red-500">Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Last Semester</label>
                      <select value={planForm.plan_left_semester}
                        onChange={e => {
                          const yg = formYearGroup
                          const endDate = yg?.semesters[parseInt(e.target.value) - 1]?.endDate || ''
                          setPlanForm(f => ({ ...f, plan_left_semester: e.target.value, end_date: endDate }))
                        }}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="1">{semesterShortLabel('1', formYearGroup)}</option>
                        <option value="2">{semesterShortLabel('2', formYearGroup)}</option>
                        <option value="3">{semesterShortLabel('3', formYearGroup)}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">End Date</label>
                      <input type="date" value={planForm.end_date}
                        onChange={e => setPlanForm(f => ({ ...f, end_date: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                </div>
              ) : (
                <button type="button"
                  onClick={() => {
                    setLeavingMidYear(true)
                    // auto-set end_date to end of Sem 3 as a starting point
                    const endDate = formYearGroup?.semesters[2]?.endDate || ''
                    setPlanForm(f => ({ ...f, end_date: endDate }))
                  }}
                  className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2">
                  Student is leaving / graduating this year →
                </button>
              )}
            </div>

            {/* ── Section 3: Payment Terms ────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Total Amount Owed
                  {formProrated && <span className="ml-1 text-blue-500 font-normal">(calculated)</span>}
                </label>
                {formProrated ? (
                  <div className="flex items-center gap-2 border border-blue-200 bg-blue-50 rounded-lg px-3 py-2">
                    <span className="text-sm font-bold text-blue-800">{formatCurrency(formProrated.owed)}</span>
                    <span className="text-xs text-blue-400">
                      {formProrated.came === 1 ? 'full year' : `from Sem ${formProrated.came}`}
                    </span>
                  </div>
                ) : planForm.payment_structure === 'annual' ? (
                  <div className="border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-xs text-amber-700">
                    Enter the <strong>Annual Tuition Rate</strong> in the Yearly Billing section above — the total owed will be calculated automatically based on the semester the student started.
                  </div>
                ) : (
                  <input type="number" step="0.01" min="0" value={planForm.total_amount}
                    onChange={e => setPlanForm(f => ({ ...f, total_amount: e.target.value }))}
                    placeholder="What this student owes"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Discount Amount</label>
                <input type="number" step="0.01" min="0" value={planForm.discount_amount}
                  onChange={e => setPlanForm(f => ({ ...f, discount_amount: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Building Fund Amount</label>
                <input type="number" step="0.01" min="0" value={planForm.building_fund_amount}
                  disabled={planForm.building_fund_waived}
                  onChange={e => setPlanForm(f => ({ ...f, building_fund_amount: e.target.value }))}
                  placeholder="0"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400" />
                <label className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-500">
                  <input type="checkbox" checked={planForm.building_fund_waived}
                    onChange={e => setPlanForm(f => ({ ...f, building_fund_waived: e.target.checked }))} />
                  Waive building fund for this student
                </label>
                <p className="text-xs text-slate-400 mt-1">Tracked separately from tuition, but counts toward the total balance due — unless waived.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Payment Structure</label>
                <select value={planForm.payment_structure} onChange={e => setPlanForm(f => ({ ...f, payment_structure: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— select —</option>
                  {PAYMENT_STRUCTURES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
                {planForm.payment_structure === 'custom' && (
                  <input value={planForm.payment_structure_custom}
                    onChange={e => setPlanForm(f => ({ ...f, payment_structure_custom: e.target.value }))}
                    placeholder="e.g. 3 Lump Sums, 1 Lump Sum"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Payment Amount (per installment)</label>
                <input type="number" step="0.01" min="0" value={planForm.payment_amount}
                  onChange={e => setPlanForm(f => ({ ...f, payment_amount: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Payment Day of Month</label>
                <input type="number" min="1" max="31" value={planForm.payment_day}
                  onChange={e => setPlanForm(f => ({ ...f, payment_day: e.target.value }))}
                  placeholder="e.g. 1"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Preferred Payment Method</label>
                <select value={planForm.preferred_payment_method}
                  onChange={e => setPlanForm(f => ({ ...f, preferred_payment_method: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— select —</option>
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>

            {/* ── Section 4: Reminder ─────────────────────────────────────── */}
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-amber-600" />
                <p className="text-sm font-medium text-amber-900">Payment Reminder</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-amber-700 mb-1">Remind me on</label>
                  <input type="date" value={planForm.reminder_date}
                    onChange={e => setPlanForm(f => ({ ...f, reminder_date: e.target.value }))}
                    className="w-full border border-amber-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-700 mb-1">Note <span className="font-normal">(optional)</span></label>
                  <input value={planForm.reminder_note}
                    onChange={e => setPlanForm(f => ({ ...f, reminder_note: e.target.value }))}
                    placeholder="e.g. Call if payment not received"
                    className="w-full border border-amber-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
              </div>
              {planForm.reminder_date && (
                <button type="button" onClick={() => setPlanForm(f => ({ ...f, reminder_date: '', reminder_note: '' }))}
                  className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1">
                  <BellOff size={12} /> Clear reminder
                </button>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
              <textarea value={planForm.notes} onChange={e => setPlanForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={savingPlan}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                {savingPlan ? 'Saving…' : editingPlan ? 'Save Changes' : 'Create Plan'}
              </button>
              <button type="button" onClick={() => setShowAddPlan(false)}
                className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Tuition Plans ──────────────────────────────────────────────────── */}
      {plans.length === 0 && !showAddPlan ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center">
          <DollarSign size={36} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No tuition plans yet.</p>
          <button onClick={openAddPlan} className="mt-3 text-blue-600 hover:text-blue-700 text-sm font-medium">Add a plan</button>
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map(plan => {
            const planPayments = payments.filter(p => p.tuition_plan_id === plan.id)
            const bal          = planBalances(plan, planPayments)
            const isExpanded   = expandedPlan === plan.id
            const rs           = reminderStatus(plan.reminder_date)

            // Yearly prorated info for display
            const planProrated = proratedInfo(
              plan.yearly_amount,
              plan.plan_came_semester || '1',
              plan.plan_left_semester || '3',
              getYearGroup(plan.academic_year),
            )

            return (
              <div key={plan.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                {/* Plan card header */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900">{plan.academic_year}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusBadge(plan.status)}`}>
                        {plan.status}
                      </span>
                      <span className="text-xs text-slate-400 capitalize">{structureLabel(plan)}</span>
                      {plan.preferred_payment_method && (
                        <span className="text-xs text-slate-400">· {paymentMethodLabel(plan.preferred_payment_method)}</span>
                      )}
                      {rs !== 'none' && (() => {
                        const colors = { overdue: 'text-red-600 bg-red-50', today: 'text-orange-600 bg-orange-50', soon: 'text-amber-600 bg-amber-50', future: 'text-blue-600 bg-blue-50' }[rs]
                        const label  = { overdue: 'Reminder overdue', today: 'Reminder: today', soon: 'Reminder: soon', future: `Reminder: ${new Date(plan.reminder_date! + 'T00:00:00').toLocaleDateString()}` }[rs]
                        return (
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${colors}`}>
                            <Bell size={10} /> {label}
                          </span>
                        )
                      })()}
                    </div>

                    {/* Yearly billing summary line */}
                    {planProrated && plan.yearly_amount && (
                      <p className="text-xs text-blue-600 mt-0.5">
                        Annual rate {formatCurrency(plan.yearly_amount)} · Sem {planProrated.came}–{planProrated.left} ({planProrated.count} of 3 semesters by days) = <strong>{formatCurrency(planProrated.owed)}</strong> owed
                      </p>
                    )}

                    <div className="flex items-center gap-4 mt-1 text-sm text-slate-500 flex-wrap">
                      <span>Tuition: <span className="text-slate-700 font-medium">{formatCurrency(bal.netTuition)}</span></span>
                      <span>Paid: <span className="text-green-600 font-medium">{formatCurrency(bal.tuitionPaid)}</span></span>
                      <span>Balance: <span className={`font-medium ${bal.tuitionBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {bal.tuitionBalance > 0 ? formatCurrency(bal.tuitionBalance) : 'Paid in Full'}
                      </span></span>
                      {plan.preferred_payment_method && (
                        <span>Method: <span className="text-slate-700 font-medium">{paymentMethodLabel(plan.preferred_payment_method)}</span></span>
                      )}
                    </div>
                    {(bal.buildingFund > 0 || plan.building_fund_waived) && (
                      <div className="flex items-center gap-4 mt-1 text-sm text-slate-500 flex-wrap">
                        {plan.building_fund_waived ? (
                          <span>Building Fund: <span className="text-slate-400 font-medium">Waived</span></span>
                        ) : (
                          <>
                            <span>Building Fund: <span className="text-slate-700 font-medium">{formatCurrency(bal.buildingFund)}</span></span>
                            <span>Paid: <span className="text-green-600 font-medium">{formatCurrency(bal.buildingFundPaid)}</span></span>
                            <span>Balance: <span className={`font-medium ${bal.buildingFundBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {bal.buildingFundBalance > 0 ? formatCurrency(bal.buildingFundBalance) : 'Paid in Full'}
                            </span></span>
                          </>
                        )}
                      </div>
                    )}
                    {bal.buildingFund > 0 && (
                      <p className="text-xs mt-1">
                        <span className="text-slate-500">Total Balance Due: </span>
                        <span className={`font-semibold ${bal.totalBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {bal.totalBalance > 0 ? formatCurrency(bal.totalBalance) : 'Paid in Full'}
                        </span>
                      </p>
                    )}
                    {plan.discount_amount > 0 && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        Discount: {formatCurrency(Number(plan.discount_amount))} · {formatCurrency(Number(plan.total_amount))} base
                      </p>
                    )}
                    {plan.reminder_note && rs !== 'none' && (
                      <p className="text-xs text-amber-600 mt-0.5">{plan.reminder_note}</p>
                    )}
                    {plan.notes && (
                      <p className="text-xs text-slate-500 mt-0.5 italic">Note: {plan.notes}</p>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="hidden sm:block w-32 flex-shrink-0">
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${Math.min(100, bal.totalCharges > 0 ? (bal.totalPaid / bal.totalCharges) * 100 : 0)}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-400 mt-1 text-right">
                      {bal.totalCharges > 0 ? Math.round((bal.totalPaid / bal.totalCharges) * 100) : 0}%
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={e => { e.stopPropagation(); openAddPayment(plan.id) }}
                      className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors" title="Add payment">
                      <Plus size={13} />
                      Add Payment
                    </button>
                    <button onClick={e => { e.stopPropagation(); printBill(plan, planPayments) }}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View bill / statement">
                      <Printer size={14} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); emailBill(plan, planPayments) }}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Email bill / statement">
                      <Mail size={14} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); openEditPlan(plan) }}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit plan">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); deletePlan(plan.id) }}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete plan">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Expanded section */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-5 py-4 space-y-4">

                    {/* Yearly overview (shown when yearly_amount is set) */}
                    <YearlyOverview plan={plan} payments={planPayments.filter(p => (p.payment_type ?? 'tuition') === 'tuition')} />

                    {/* Payment records */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-slate-700">Payment Records</h3>
                        <button
                          onClick={() => openAddPayment(plan.id)}
                          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                        >
                          <Plus size={13} />
                          Add Payment
                        </button>
                      </div>

                      {/* Add/edit payment form */}
                      {showAddPayment === plan.id && (
                        <div className="bg-slate-50 rounded-lg p-4 mb-3 border border-slate-200">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-medium text-slate-700">{editingPayment ? 'Edit Payment' : 'Record Payment'}</p>
                            <button onClick={() => { setShowAddPayment(null); setEditingPayment(null) }} className="text-slate-400 hover:text-slate-600">
                              <X size={15} />
                            </button>
                          </div>
                          <form onSubmit={savePayment} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">Amount</label>
                              <input type="number" step="0.01" min="0" value={paymentForm.amount}
                                onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                                placeholder={formatCurrency(Number(plan.payment_amount))}
                                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
                              <select value={paymentForm.status} onChange={e => setPaymentForm(f => ({ ...f, status: e.target.value }))}
                                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">Due Date</label>
                              <input type="date" value={paymentForm.due_date}
                                onChange={e => setPaymentForm(f => ({ ...f, due_date: e.target.value }))}
                                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">Payment Date</label>
                              <input type="date" value={paymentForm.payment_date}
                                onChange={e => setPaymentForm(f => ({ ...f, payment_date: e.target.value }))}
                                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">Payment Method</label>
                              <select value={paymentForm.payment_method} onChange={e => setPaymentForm(f => ({ ...f, payment_method: e.target.value }))}
                                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="">— select —</option>
                                {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">Payment Type</label>
                              <select value={paymentForm.payment_type} onChange={e => setPaymentForm(f => ({ ...f, payment_type: e.target.value }))}
                                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="tuition">Tuition Payment</option>
                                <option value="building_fund">Building Fund</option>
                                <option value="donation">Donation</option>
                              </select>
                              {paymentForm.payment_type === 'donation' && (
                                <p className="text-xs text-slate-400 mt-1">Recorded here, but won&apos;t count toward tuition or building fund balance.</p>
                              )}
                              {paymentForm.payment_type === 'building_fund' && (
                                <p className="text-xs text-slate-400 mt-1">Counts toward the building fund balance, not tuition.</p>
                              )}
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">Check / Transaction #</label>
                              <input value={paymentForm.transaction_id} onChange={e => setPaymentForm(f => ({ ...f, transaction_id: e.target.value }))}
                                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
                              <input value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))}
                                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div className="sm:col-span-2 flex gap-2">
                              <button type="submit" disabled={savingPayment}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors">
                                {savingPayment ? 'Saving…' : editingPayment ? 'Save' : 'Record Payment'}
                              </button>
                              <button type="button" onClick={() => { setShowAddPayment(null); setEditingPayment(null) }}
                                className="px-3 py-1.5 rounded-lg text-xs text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors">
                                Cancel
                              </button>
                            </div>
                          </form>
                        </div>
                      )}

                      {planPayments.length === 0 ? (
                        <p className="text-xs text-slate-400 py-2">No payment records yet.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-100">
                                <th className="pb-2 text-left text-xs font-medium text-slate-400">Due Date</th>
                                <th className="pb-2 text-left text-xs font-medium text-slate-400">Paid Date</th>
                                <th className="pb-2 text-right text-xs font-medium text-slate-400">Amount</th>
                                <th className="pb-2 text-left text-xs font-medium text-slate-400 pl-3">Status</th>
                                <th className="pb-2 text-left text-xs font-medium text-slate-400 hidden md:table-cell">Method</th>
                                <th className="pb-2 w-14" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {planPayments.map(pay => (
                                <tr key={pay.id} className="hover:bg-slate-50">
                                  <td className="py-2 text-slate-600">
                                    {pay.due_date ? new Date(pay.due_date).toLocaleDateString() : <span className="text-slate-300">—</span>}
                                  </td>
                                  <td className="py-2 text-slate-600">
                                    {pay.payment_date ? new Date(pay.payment_date).toLocaleDateString() : <span className="text-slate-300">—</span>}
                                  </td>
                                  <td className="py-2 text-right font-medium text-slate-900">{formatCurrency(Number(pay.amount))}</td>
                                  <td className="py-2 pl-3">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusBadge(pay.status)}`}>
                                        {planStatusIcon(pay.status)}
                                        {pay.status}
                                      </span>
                                      {pay.payment_type === 'donation' && (
                                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">Donation</span>
                                      )}
                                      {pay.payment_type === 'building_fund' && (
                                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">Building Fund</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 text-xs text-slate-400 hidden md:table-cell">
                                    {paymentMethodLabel(pay.payment_method)}
                                    {pay.transaction_id && <span className="ml-1 text-slate-300">#{pay.transaction_id}</span>}
                                  </td>
                                  <td className="py-2">
                                    <div className="flex items-center gap-1 justify-end">
                                      {pay.status === 'paid' && (
                                        <>
                                          <button onClick={() => printReceipt(plan, pay)} className="p-1 text-slate-300 hover:text-blue-600 transition-colors" title="View receipt">
                                            <Receipt size={13} />
                                          </button>
                                          <button onClick={() => emailReceipt(plan, pay)} className="p-1 text-slate-300 hover:text-blue-600 transition-colors" title="Email receipt">
                                            <Mail size={13} />
                                          </button>
                                        </>
                                      )}
                                      <button onClick={() => openEditPayment(pay)} className="p-1 text-slate-300 hover:text-blue-600 transition-colors" title="Edit">
                                        <Edit2 size={13} />
                                      </button>
                                      <button onClick={() => deletePayment(pay.id)} className="p-1 text-slate-300 hover:text-red-600 transition-colors" title="Delete">
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {emailModal && (
        <EmailPdfModal
          onClose={() => setEmailModal(null)}
          defaultRecipients={emailModal.defaultRecipients}
          defaultSubject={emailModal.defaultSubject}
          defaultBody={emailModal.defaultBody}
          buildAttachment={emailModal.buildAttachment}
          logContext={{ studentId }}
        />
      )}
    </div>
  )
}
