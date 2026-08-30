'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft, GraduationCap, Plus, X, DollarSign, CheckCircle,
  Clock, AlertCircle, Edit2, Trash2, Bell, BellOff, CalendarRange, Printer, Receipt, Mail,
  Phone, MapPin, CreditCard, Repeat, Ban, CalendarCheck, Heart, Check
} from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import { SCHOOL_YEAR_SEMESTERS, studentDisplayStatus, isDateUpcoming, currentGradeLevel } from '@/lib/semesters'
import {
  generateTuitionBillPDF, generatePaymentReceiptPDF,
  getTuitionBillPdfBase64, getPaymentReceiptPdfBase64,
} from '@/lib/tuitionPdf'
import { openPreviewTab } from '@/lib/pdfPreview'
import EmailPdfModal from '@/components/EmailPdfModal'
import PrintNoteModal from '@/components/PrintNoteModal'
import SentLettersPanel from '@/components/SentLettersPanel'
import TuitionDocumentsPanel from '@/components/TuitionDocumentsPanel'
import ChargeModal from '@/components/sola/ChargeModal'
import RecurringModal from '@/components/sola/RecurringModal'
import ManageRecurringModal from '@/components/sola/ManageRecurringModal'
import RecalculateScheduleModal from '@/components/sola/RecalculateScheduleModal'
import IncomingSolaPayments, { type PendingSolaPayment } from '@/components/sola/IncomingSolaPayments'

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
  tuition_plan_id: string | null
  student_id: string
  amount: number
  payment_date: string | null
  due_date: string | null
  status: string
  payment_method: string | null
  payment_type: string | null
  transaction_id: string | null
  notes: string | null
  // First-of-month date this payment applies toward, for yearly-billed plans
  // with a month-by-month breakdown — lets the backfill view know which past
  // months are already covered, independent of when the payment was made.
  period_month: string | null
  created_at: string
}

// A Sola recurring schedule — covers Phone Charge (know whether a
// subscription is currently active, so real credit-card billing continues
// on Sola's own clock without any monthly staff action) and Tuition/Building
// Fund (know whether a fixed-#-of-payments plan's schedule still matches
// what's actually owed after a manual payment).
type PaymentSchedule = {
  id: string
  status: string
  amount: number
  start_date: string
  interval_type: string
  interval_count: number
  purpose: string
  total_payments: number | null
  payment_method_id: string | null
  created_at: string
}

// A donation made by this student's linked parent(s) — display-only here,
// never part of any tuition/building-fund/registration-fee balance math.
type ParentDonation = {
  id: string; donor_id: string; amount: number; donation_date: string
  category: string | null; event_id: string | null; source: string
  donors: { name: string } | null
  events: { name: string } | null
}
function donationCategoryLabel(c: string | null) {
  if (c === 'monthly_recurring') return 'Monthly Recurring'
  if (c === 'event') return 'Event'
  if (c === 'one_time') return 'One-Time'
  return null
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

// Registration fee payments have no tuition_plan_id (they aren't tied to a
// plan/year) — this sentinel stands in for a plan id in showAddPayment/
// savePayment so the same add/edit-payment machinery can be reused for them.
const REG_FEE_KEY = 'registration_fee'

// Phone Charge payments have no tuition_plan_id either (same reasoning as
// registration fee) — its own sentinel so the two never collide.
const PHONE_CHARGE_KEY = 'phone_charge'

// Building fund payments DO have a real tuition_plan_id — but "Add Payment"
// can be opened either from the plan's general Payment Records section or
// from the dedicated Building Fund panel below, and both can be open for the
// same plan at once. This prefix gives the Building Fund panel's own form
// instance a distinct showAddPayment key so the two never collide.
const BF_PREFIX = 'bf:'
const bfKey = (planId: string) => `${BF_PREFIX}${planId}`
const isBfKey = (key: string | null) => !!key && key.startsWith(BF_PREFIX)
const planIdFromKey = (key: string) => (isBfKey(key) ? key.slice(BF_PREFIX.length) : key)

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function structureLabel(plan: Pick<TuitionPlan, 'payment_structure' | 'payment_structure_custom'>) {
  if (plan.payment_structure === 'custom') return plan.payment_structure_custom || 'Custom'
  return plan.payment_structure
}
const STATUSES = ['paid', 'partial', 'forgiven', 'pending', 'overdue', 'waived'] as const

// A 'partial' payment is real money received (just not the full amount due
// yet) and a 'forgiven' payment writes off a charge without money changing
// hands — both reduce the outstanding balance the same way 'paid' does.
const COUNTS_AS_PAID = ['paid', 'partial', 'forgiven']

function statusLabel(status: string) {
  if (status === 'forgiven') return 'Forgiven'
  if (status === 'partial') return 'Partial'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

// Tuition and Building Fund are tracked as separate charges/balances that both
// count toward what the family owes; Donation payments don't reduce either.
function planBalances(plan: TuitionPlan, planPayments: TuitionPayment[]) {
  const netTuition = Number(plan.total_amount) - Number(plan.discount_amount)
  const buildingFund = plan.building_fund_waived ? 0 : Number(plan.building_fund_amount ?? 0)
  const tuitionPaid = planPayments
    .filter(p => COUNTS_AS_PAID.includes(p.status) && (p.payment_type ?? 'tuition') === 'tuition')
    .reduce((s, p) => s + Number(p.amount), 0)
  const buildingFundPaid = planPayments
    .filter(p => COUNTS_AS_PAID.includes(p.status) && p.payment_type === 'building_fund')
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

// A fixed-#-of-payments schedule's amount is only correct as of when it was
// created — if a manual payment (recorded by staff, not the schedule itself)
// lands afterward, the balance it's dividing has changed and the schedule
// doesn't know. Sola-driven charges (both this schedule's own installments
// and any one-time "Charge Now") are tagged with this exact note by
// lib/sola/ledger.ts — anything else recorded since the schedule started is
// a manual entry that the schedule's math hasn't accounted for.
const SOLA_CHARGE_NOTE_PREFIX = 'Sola charge — ref'
function scheduleNeedsRecalc(schedule: PaymentSchedule, planPayments: TuitionPayment[], purpose: 'tuition' | 'building_fund'): boolean {
  if (schedule.status !== 'active' || !schedule.total_payments) return false
  return planPayments.some(p =>
    (p.payment_type ?? 'tuition') === purpose &&
    COUNTS_AS_PAID.includes(p.status) &&
    !!p.payment_date && p.payment_date >= schedule.start_date &&
    !(p.notes ?? '').startsWith(SOLA_CHARGE_NOTE_PREFIX)
  )
}

// Registration fee is a flat one-time charge tracked on the student (not
// tied to any tuition plan/year), but — like building fund — the amount
// actually collected is the sum of its 'registration_fee' payment rows, so
// it can be paid in full, partially, or forgiven just like the others.
function regFeeBalances(student: Pick<Student, 'registration_fee_amount'>, allPayments: TuitionPayment[]) {
  const regFeePayments = allPayments.filter(p => p.payment_type === 'registration_fee')
  const charge = Number(student.registration_fee_amount ?? 0)
  const paid = regFeePayments
    .filter(p => COUNTS_AS_PAID.includes(p.status))
    .reduce((s, p) => s + Number(p.amount), 0)
  return { regFeePayments, charge, paid, balance: charge - paid }
}

// Phone Charge is open-ended recurring (no fixed total to be "paid in full"
// against, unlike registration fee) — just the running history and total
// collected so far. Whether it's currently billing lives in payment_schedules.
function phoneChargeTotals(allPayments: TuitionPayment[]) {
  const phoneChargePayments = allPayments.filter(p => p.payment_type === 'phone_charge')
  const paid = phoneChargePayments
    .filter(p => COUNTS_AS_PAID.includes(p.status))
    .reduce((s, p) => s + Number(p.amount), 0)
  return { phoneChargePayments, paid }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function paymentMethodLabel(v: string | null) {
  if (!v) return '—'
  return PAYMENT_METHODS.find(m => m.value === v)?.label ?? v.replace(/_/g, ' ')
}

function scheduleCadenceLabel(s: PaymentSchedule) {
  const amt = formatCurrency(Number(s.amount))
  if (s.interval_type === 'month' && s.interval_count === 1) return `${amt}/mo`
  return `${amt} every ${s.interval_count} ${s.interval_type}${s.interval_count > 1 ? 's' : ''}`
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

// Whether this plan's coverage hasn't started yet — e.g. a plan set up ahead
// of time for a pending student's upcoming semester. Falls back to the
// academic year's first semester start date when the plan has no explicit
// start_date (e.g. an annual/prorated plan).
function planIsUpcoming(plan: TuitionPlan): boolean {
  const startDate = plan.start_date || getYearGroup(plan.academic_year)?.semesters[0]?.startDate
  return isDateUpcoming(startDate)
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
type MonthEntry = { label: string; shortLabel: string; semester: number; days: number; amount: number; monthKey: string }

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
        monthKey: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`,
      })
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
  }
  return entries
}

type MonthBackfillEntry = MonthEntry & { paidSoFar: number; remaining: number; isPast: boolean }

// Months from a yearly-billed plan that aren't fully paid yet, matched
// against tuition payments by their period_month (not payment_date, since a
// late payment can still be applied to an earlier month's charge). Used for
// the backfill view — recording payments against past unpaid months.
function unpaidMonths(plan: TuitionPlan, planPayments: TuitionPayment[]): MonthBackfillEntry[] {
  if (!plan.yearly_amount) return []
  const yearGroup = getYearGroup(plan.academic_year)
  if (!yearGroup) return []
  const came = parseInt(plan.plan_came_semester || '1') || 1
  const left = parseInt(plan.plan_left_semester || '3') || 3
  const months = monthlyBreakdown(plan.yearly_amount, yearGroup, came, left)
  const today = new Date(); today.setHours(0, 0, 0, 0)

  return months
    .map(m => {
      const paidSoFar = planPayments
        .filter(p => COUNTS_AS_PAID.includes(p.status) && (p.payment_type ?? 'tuition') === 'tuition' && p.period_month === m.monthKey)
        .reduce((s, p) => s + Number(p.amount), 0)
      const monthStart = new Date(m.monthKey + 'T00:00:00')
      return { ...m, paidSoFar, remaining: m.amount - paidSoFar, isPast: monthStart <= today }
    })
    .filter(m => m.remaining > 0.005)
}

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    partial: 'bg-amber-100 text-amber-700',
    forgiven: 'bg-purple-100 text-purple-700',
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
  if (status === 'paid')     return <CheckCircle size={14} className="text-green-600" />
  if (status === 'forgiven') return <Ban size={14} className="text-purple-600" />
  if (status === 'partial')  return <Clock size={14} className="text-amber-600" />
  if (status === 'overdue')  return <AlertCircle size={14} className="text-red-600" />
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

// ── Payment form (add/edit) ─────────────────────────────────────────────────
// Shared between a plan's "Payment Records" section (tuition/building_fund/
// donation) and the Registration Fee panel (locked to payment_type
// 'registration_fee', which isn't tied to any plan) — both need the same
// backdatable-date + flexible-amount + partial/forgiven-status fields.

type PaymentFormState = {
  amount: string; due_date: string; payment_date: string; period_month: string
  status: string; payment_method: string; payment_type: string
  transaction_id: string; notes: string
}

function PaymentForm({
  form, setForm, onSubmit, onCancel, editing, saving,
  remainingBalance, lockedType, monthOptions,
}: {
  form: PaymentFormState
  setForm: React.Dispatch<React.SetStateAction<PaymentFormState>>
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
  editing: boolean
  saving: boolean
  remainingBalance?: number
  lockedType?: string
  monthOptions?: MonthBackfillEntry[]
}) {
  return (
    <div className="bg-slate-50 rounded-lg p-4 mb-3 border border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-slate-700">{editing ? 'Edit Payment' : 'Record Payment'}</p>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={15} /></button>
      </div>
      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-slate-500">Amount</label>
            {remainingBalance != null && remainingBalance > 0 && (
              <button type="button"
                onClick={() => setForm(f => ({ ...f, amount: remainingBalance.toFixed(2), status: 'paid' }))}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                Use full balance ({formatCurrency(remainingBalance)})
              </button>
            )}
          </div>
          <input type="number" step="0.01" min="0" value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            placeholder="Enter the amount actually collected"
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
          <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          {form.status === 'partial' && (
            <p className="text-xs text-amber-600 mt-1">Enter only the amount actually collected — log more payments later for the rest.</p>
          )}
          {form.status === 'forgiven' && (
            <p className="text-xs text-purple-600 mt-1">The amount below is written off and won&apos;t count against the balance — no money needs to have changed hands.</p>
          )}
        </div>
        {monthOptions && monthOptions.length > 0 && (
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Applies to Month <span className="font-normal text-slate-400">(optional — for backfilling a past month)</span></label>
            <select value={form.period_month}
              onChange={e => {
                const key = e.target.value
                const m = monthOptions.find(mo => mo.monthKey === key)
                setForm(f => ({ ...f, period_month: key, amount: m ? m.remaining.toFixed(2) : f.amount }))
              }}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— not tied to a specific month —</option>
              {monthOptions.map(m => (
                <option key={m.monthKey} value={m.monthKey}>
                  {m.label} — {m.paidSoFar > 0 ? `${formatCurrency(m.remaining)} remaining of ${formatCurrency(m.amount)}` : `${formatCurrency(m.amount)} due`}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Due Date</label>
          <input type="date" value={form.due_date}
            onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Payment Date <span className="font-normal text-slate-400">(any past or present date)</span></label>
          <input type="date" value={form.payment_date} max={todayStr()}
            onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Payment Method</label>
          <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— select —</option>
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        {lockedType ? (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Payment Type</label>
            <div className={`w-full border rounded-lg px-3 py-1.5 text-sm font-medium ${
              lockedType === 'building_fund' ? 'border-amber-200 bg-amber-50 text-amber-700' :
              lockedType === 'phone_charge'  ? 'border-sky-200 bg-sky-50 text-sky-700' :
              'border-rose-200 bg-rose-50 text-rose-700'
            }`}>
              {lockedType === 'building_fund' ? 'Building Fund' : lockedType === 'phone_charge' ? 'Phone Charge' : 'Registration Fee'}
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Payment Type</label>
            <select value={form.payment_type} onChange={e => setForm(f => ({ ...f, payment_type: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="tuition">Tuition Payment</option>
              <option value="building_fund">Building Fund</option>
              <option value="donation">Donation</option>
            </select>
            {form.payment_type === 'donation' && (
              <p className="text-xs text-slate-400 mt-1">Recorded here, but won&apos;t count toward tuition or building fund balance.</p>
            )}
            {form.payment_type === 'building_fund' && (
              <p className="text-xs text-slate-400 mt-1">Counts toward the building fund balance, not tuition.</p>
            )}
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Check / Transaction #</label>
          <input value={form.transaction_id} onChange={e => setForm(f => ({ ...f, transaction_id: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="sm:col-span-2 flex gap-2">
          <button type="submit" disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : editing ? 'Save' : 'Record Payment'}
          </button>
          <button type="button" onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors">
            Cancel
          </button>
        </div>
      </form>
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
  const [pendingPrint, setPendingPrint] = useState<{
    title: string
    subject: string
    run: (note: string | undefined, win: Window | null) => Promise<{ base64: string; filename: string }>
  } | null>(null)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(false)
  // Individual queries in load() below can fail (RLS, timeout, transient
  // Postgrest error) without throwing — Supabase resolves with {data: null,
  // error} rather than rejecting, so a silent `data ?? []` previously masked
  // this as "no records" instead of "couldn't load records," which is how a
  // fully-paid plan could render as if nothing had ever been paid.
  const [dataWarnings, setDataWarnings] = useState<string[]>([])
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null)

  const [showAddPlan, setShowAddPlan]   = useState(false)
  const [planForm, setPlanForm]         = useState({ ...BLANK_PLAN_FORM })
  const [editingPlan, setEditingPlan]   = useState<TuitionPlan | null>(null)
  const [savingPlan, setSavingPlan]     = useState(false)
  const [leavingMidYear, setLeavingMidYear] = useState(false)
  const [customStartDate, setCustomStartDate] = useState(false)

  // showAddPayment holds either a real tuition_plan_id, or the REG_FEE_KEY
  // sentinel when recording a registration fee payment (which isn't tied to
  // any plan).
  const [showAddPayment, setShowAddPayment]   = useState<string | null>(null)
  const [paymentForm, setPaymentForm]         = useState({ amount: '', due_date: '', payment_date: '', period_month: '', status: 'paid', payment_method: '', payment_type: 'tuition', transaction_id: '', notes: '' })
  const [editingPayment, setEditingPayment]   = useState<TuitionPayment | null>(null)
  const [savingPayment, setSavingPayment]     = useState(false)

  const [savedPaymentMethods, setSavedPaymentMethods] = useState<{ id: string; label: string }[]>([])
  const [showChargeModal, setShowChargeModal] = useState(false)
  const [showRecurringModal, setShowRecurringModal] = useState(false)
  const [showPhoneRecurringModal, setShowPhoneRecurringModal] = useState(false)
  const [manageScheduleId, setManageScheduleId] = useState<string | null>(null)
  const [schedules, setSchedules] = useState<PaymentSchedule[]>([])
  const [parentDonations, setParentDonations] = useState<ParentDonation[]>([])
  const [pendingSolaPayments, setPendingSolaPayments] = useState<PendingSolaPayment[]>([])
  const [recalcTarget, setRecalcTarget] = useState<{
    purpose: 'tuition' | 'building_fund'; purposeLabel: string; schedule: PaymentSchedule; remainingBalance: number
  } | null>(null)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      // tuition_payments is fetched as a nested embed on students, not a
      // standalone request — confirmed live that some school network content
      // filters block any direct request to that resource outright (a
      // "TypeError: Failed to fetch" that leaves `payments` looking like an
      // empty-but-successful result, silently rendering a fully-paid plan as
      // if nothing had ever been paid). Piggybacking on the students request
      // reuses the exact same workaround already proven on the Tuition list
      // page (see git history: "Eliminate the separate tuition-payments
      // endpoint entirely").
      const [
        { data: s, error: sErr }, { data: p, error: pErr },
        { data: pm, error: pmErr }, { data: ds, error: dsErr }, { data: sched, error: schedErr },
      ] = await Promise.all([
        supabase.from('students')
          .select('id,first_name,last_name,grade_level,student_id,status,came_semester,semester_left,address,home_phone,father_name,father_cell,father_email,mother_name,mother_cell,mother_email,parents_title,registration_fee_status,registration_fee_amount,registration_fee_paid_date,tuition_payments(*)')
          .eq('id', studentId).single(),
        supabase.from('tuition_plans').select('*').eq('student_id', studentId).order('created_at', { ascending: false }),
        supabase.from('payment_methods').select('id,label').eq('student_id', studentId).order('created_at', { ascending: false }),
        supabase.from('donor_students').select('donor_id').eq('student_id', studentId),
        supabase.from('payment_schedules').select('id,status,amount,start_date,interval_type,interval_count,purpose,total_payments,payment_method_id,created_at')
          .eq('student_id', studentId).order('created_at', { ascending: false }),
      ])
      const warnings: string[] = []
      if (sErr) warnings.push(`Student record (incl. tuition payments): ${sErr.message}`)
      if (pErr) warnings.push(`Tuition plans: ${pErr.message}`)
      if (pmErr) warnings.push(`Payment methods: ${pmErr.message}`)
      if (dsErr) warnings.push(`Linked donors: ${dsErr.message}`)
      if (schedErr) warnings.push(`Recurring schedules: ${schedErr.message}`)
      setDataWarnings(warnings)
      if (warnings.length) console.error('Tuition page partial load failure:', warnings)

      const { tuition_payments, ...studentFields } = (s ?? {}) as typeof s & { tuition_payments?: TuitionPayment[] }
      setStudent(s ? studentFields : null)
      setPlans(p || [])
      setPayments((tuition_payments || []).slice().sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')))
      setSavedPaymentMethods((pm || []).map(m => ({ id: m.id, label: m.label || 'Saved payment method' })))
      setSchedules(sched || [])

      // Donations made by this student's linked parent(s) — kept in a
      // completely separate fetch/table from tuition_payments so they can
      // never leak into tuition/building-fund/registration-fee balances.
      const donorIds = (ds ?? []).map(r => r.donor_id)
      if (donorIds.length) {
        const { data: dons } = await supabase
          .from('donations')
          .select('id,donor_id,amount,donation_date,category,event_id,source,donors(name),events(name)')
          .in('donor_id', donorIds)
          .eq('archived', false)
          .order('donation_date', { ascending: false })
        setParentDonations((dons ?? []) as unknown as ParentDonation[])
      } else {
        setParentDonations([])
      }
    } catch {
      // Network-level fetch failure (flaky connection, ad blocker) that
      // survived the Supabase client's own retries — surface a retry
      // affordance instead of leaving an unhandled console error.
      setLoadError(true)
    }
    setLoading(false)
  }, [studentId, supabase])

  // Completely separate from load() on purpose — some networks block
  // requests to the sola_sync_* tables outright ("TypeError: Failed to
  // fetch"), the same class of issue already documented elsewhere in this
  // codebase for tuition_payments. This card is a nice-to-have; it must
  // never be able to take the whole page down (or into the retry-error
  // state) if it fails, so it gets its own effect and swallows any error.
  const loadPendingSolaPayments = useCallback(async () => {
    try {
      const { data: syncCustomers } = await supabase.from('sola_sync_customers').select('id').eq('matched_student_id', studentId)
      const syncCustomerIds = (syncCustomers ?? []).map(c => c.id)
      if (!syncCustomerIds.length) return
      const { data: pending } = await supabase.from('sola_sync_payments')
        .select('id,sola_sync_customer_id,sola_sync_schedule_id,amount,transaction_date,charge_kind,suggested_fee_type,suggested_donation_category,import_status')
        .in('sola_sync_customer_id', syncCustomerIds).in('import_status', ['pending', 'needs_review']).eq('gateway_status', 'Approved')
        .order('transaction_date')
      setPendingSolaPayments((pending ?? []) as PendingSolaPayment[])
    } catch {
      // Best-effort — leave the card empty rather than blocking or erroring
      // the page over a request some networks can't complete.
    }
  }, [studentId, supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await
  useEffect(() => { load(); loadPendingSolaPayments() }, [load, loadPendingSolaPayments])

  // registration_fee_status/amount on the student are just "has a fee been
  // queued, and at what base amount" — actual paid/partial/forgiven amounts
  // are tracked as tuition_payments rows (payment_type 'registration_fee'),
  // the same as tuition/building fund, via the shared Add Payment flow below.
  async function setRegistrationFee(fields: Partial<Pick<Student, 'registration_fee_status' | 'registration_fee_amount' | 'registration_fee_paid_date'>>) {
    if (!student) return
    setStudent({ ...student, ...fields })
    await supabase.from('students').update(fields).eq('id', studentId)
  }
  const addRegistrationFee = (amount: number) => setRegistrationFee({ registration_fee_status: 'pending', registration_fee_amount: amount, registration_fee_paid_date: null })
  const removeRegistrationFee = () => setRegistrationFee({ registration_fee_status: null, registration_fee_paid_date: null })

  // Registration fee has no plan-level waived flag to toggle (it isn't tied
  // to a plan) — "forgive" instead writes a 'forgiven' payment row for
  // whatever balance remains, the same mechanism the Add Payment form
  // already supports, just one click instead of opening the form. Undoing
  // it is already possible via editing/deleting that row in the table below.
  async function forgiveRegistrationFee(amount: number) {
    if (!(amount > 0.005)) return
    await supabase.from('tuition_payments').insert([{
      tuition_plan_id: null, student_id: studentId, amount, payment_date: todayStr(),
      status: 'forgiven', payment_type: 'registration_fee', notes: 'Registration fee forgiven',
    }])
    load()
  }

  // Building Fund stays a per-plan charge (tuition_plan_id set, not null like
  // registration fee) since it's genuinely billed per academic year here —
  // but gets the same prominent, dedicated panel treatment. "Forgive" toggles
  // the existing building_fund_waived flag on the current plan; "alter the
  // amount" edits building_fund_amount directly, both without needing to
  // open the full Edit Plan form. Nothing here changes what already feeds
  // the tuition statement PDF (it already shows Building Fund unless waived).
  const [editingBFAmount, setEditingBFAmount] = useState(false)
  const [bfAmountInput, setBfAmountInput] = useState('')

  async function toggleBuildingFundWaived(planId: string, waived: boolean) {
    setPlans(ps => ps.map(p => p.id === planId ? { ...p, building_fund_waived: waived } : p))
    await supabase.from('tuition_plans').update({ building_fund_waived: waived }).eq('id', planId)
  }
  async function saveBuildingFundAmount(planId: string) {
    const amount = parseFloat(bfAmountInput)
    if (!(amount >= 0)) { setEditingBFAmount(false); return }
    setPlans(ps => ps.map(p => p.id === planId ? { ...p, building_fund_amount: amount } : p))
    await supabase.from('tuition_plans').update({ building_fund_amount: amount }).eq('id', planId)
    setEditingBFAmount(false)
  }

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

  // `key` is a real tuition_plan_id, REG_FEE_KEY, or bfKey(planId) (the
  // Building Fund panel's own form instance for that plan). Optional
  // `prefill` fields support quick actions like "pay in full" and the
  // backfill months view, which know the amount/type/period up front.
  function openAddPayment(key: string, prefill?: Partial<typeof paymentForm>) {
    setEditingPayment(null)
    setPaymentForm({
      amount: '', due_date: '', payment_date: todayStr(), period_month: '',
      status: 'paid', payment_method: '',
      payment_type: key === REG_FEE_KEY ? 'registration_fee' : key === PHONE_CHARGE_KEY ? 'phone_charge' : 'tuition',
      transaction_id: '', notes: '',
      ...prefill,
    })
    if (key !== REG_FEE_KEY && key !== PHONE_CHARGE_KEY) setExpandedPlan(planIdFromKey(key))
    setShowAddPayment(key)
  }

  // `keyOverride` lets the Building Fund panel's own history table open the
  // edit form inline in that panel (bfKey) instead of the plan's general
  // Payment Records section, which is where editing from there still lands.
  function openEditPayment(payment: TuitionPayment, keyOverride?: string) {
    setEditingPayment(payment)
    setPaymentForm({
      amount: String(payment.amount),
      due_date: payment.due_date || '',
      payment_date: payment.payment_date || '',
      period_month: payment.period_month || '',
      status: payment.status,
      payment_method: payment.payment_method || '',
      payment_type: payment.payment_type || 'tuition',
      transaction_id: payment.transaction_id || '',
      notes: payment.notes || '',
    })
    setShowAddPayment(keyOverride ?? (payment.tuition_plan_id || (payment.payment_type === 'phone_charge' ? PHONE_CHARGE_KEY : REG_FEE_KEY)))
  }

  async function savePayment(e: React.FormEvent) {
    e.preventDefault()
    if (!showAddPayment) return
    setSavingPayment(true)
    const isRegFee = showAddPayment === REG_FEE_KEY
    const isPhoneCharge = showAddPayment === PHONE_CHARGE_KEY
    const payload = {
      tuition_plan_id: (isRegFee || isPhoneCharge) ? null : planIdFromKey(showAddPayment),
      student_id: studentId,
      amount: paymentForm.amount !== '' ? parseFloat(paymentForm.amount) : null,
      due_date: paymentForm.due_date || null,
      payment_date: paymentForm.payment_date || null,
      period_month: paymentForm.period_month || null,
      status: paymentForm.status,
      payment_method: paymentForm.payment_method || null,
      payment_type: isRegFee ? 'registration_fee' : isPhoneCharge ? 'phone_charge' : (paymentForm.payment_type || 'tuition'),
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

  // window.open() for the preview tab has to happen inside the click that
  // actually confirms printing — not before a native prompt() (which
  // suppresses itself once that window.open shifts focus off this tab) and
  // not after an async gap either (popup-blocked by then). Deferring to the
  // PrintNoteModal's own Continue click sidesteps both: that click is its
  // own fresh, direct user gesture.
  function printBill(plan: TuitionPlan, planPayments: TuitionPayment[]) {
    if (!student) return
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ')
    setPendingPrint({
      title: 'Add a note to this statement?',
      subject: `Tuition Statement — ${name} (${plan.academic_year})`,
      run: (note, win) => generateTuitionBillPDF(billArgs(plan, planPayments, note), win),
    })
  }

  function printReceipt(plan: TuitionPlan, payment: TuitionPayment) {
    if (!student) return
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ')
    const typeLabel = payment.payment_type === 'donation' ? 'Donation' : payment.payment_type === 'building_fund' ? 'Building Fund' : 'Payment'
    setPendingPrint({
      title: 'Add a note to this receipt?',
      subject: `${typeLabel} Receipt — ${name}`,
      run: (note, win) => generatePaymentReceiptPDF(receiptArgs(plan, payment, note), win),
    })
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

  // Registration fee payments aren't tied to a plan/academic year, so they
  // get their own receipt helpers rather than routing through receiptArgs.
  function regFeeReceiptArgs(payment: TuitionPayment, extraNote?: string) {
    const bal = regFeeBalances(student!, payments)
    return {
      student: student!,
      plan: {
        academic_year: null, total_amount: 0, discount_amount: 0,
        building_fund_amount: 0, building_fund_waived: false,
        payment_structure: null, payment_structure_custom: null,
      },
      payment,
      balanceAfter: bal.balance,
      paymentMethodLabel,
      extraNote,
    }
  }

  function printRegFeeReceipt(payment: TuitionPayment) {
    if (!student) return
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ')
    setPendingPrint({
      title: 'Add a note to this receipt?',
      subject: `Registration Fee Receipt — ${name}`,
      run: (note, win) => generatePaymentReceiptPDF(regFeeReceiptArgs(payment, note), win),
    })
  }

  function emailRegFeeReceipt(payment: TuitionPayment) {
    if (!student) return
    const note = prompt('Add a note to this receipt? (optional)') || undefined
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ')
    setEmailModal({
      defaultRecipients: [student.father_email, student.mother_email].filter((e): e is string => !!e),
      defaultSubject: `Registration Fee Receipt — ${name}`,
      defaultBody: `Hi,\n\nPlease find attached your receipt for the registration fee payment of ${formatCurrency(Number(payment.amount))}.\n\nThank you.`,
      buildAttachment: () => getPaymentReceiptPdfBase64(regFeeReceiptArgs(payment, note)),
    })
  }

  // Phone Charge — same plan-independent shape as registration fee, except
  // there's no fixed total to be "in full" against (it's open-ended
  // recurring), so balanceAfter is always 0: after this month's payment,
  // nothing is outstanding for that period.
  function phoneChargeReceiptArgs(payment: TuitionPayment, extraNote?: string) {
    return {
      student: student!,
      plan: {
        academic_year: null, total_amount: 0, discount_amount: 0,
        building_fund_amount: 0, building_fund_waived: false,
        payment_structure: null, payment_structure_custom: null,
      },
      payment,
      balanceAfter: 0,
      paymentMethodLabel,
      extraNote,
    }
  }

  function printPhoneChargeReceipt(payment: TuitionPayment) {
    if (!student) return
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ')
    setPendingPrint({
      title: 'Add a note to this receipt?',
      subject: `Phone Charge Receipt — ${name}`,
      run: (note, win) => generatePaymentReceiptPDF(phoneChargeReceiptArgs(payment, note), win),
    })
  }

  function emailPhoneChargeReceipt(payment: TuitionPayment) {
    if (!student) return
    const note = prompt('Add a note to this receipt? (optional)') || undefined
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ')
    setEmailModal({
      defaultRecipients: [student.father_email, student.mother_email].filter((e): e is string => !!e),
      defaultSubject: `Phone Charge Receipt — ${name}`,
      defaultBody: `Hi,\n\nPlease find attached your receipt for the phone charge payment of ${formatCurrency(Number(payment.amount))}.\n\nThank you.`,
      buildAttachment: () => getPaymentReceiptPdfBase64(phoneChargeReceiptArgs(payment, note)),
    })
  }

  // Called from PrintNoteModal's own Continue button — that click is what
  // actually authorizes opening the preview tab, so window.open() happens
  // synchronously right here, not before this handler runs. Logs the print
  // the same way emailing already logs a send, so Sent Letters shows both.
  async function confirmPendingPrint(note: string | undefined) {
    if (!pendingPrint) return
    const win = openPreviewTab()
    const { subject } = pendingPrint
    setPendingPrint(null)
    const { base64, filename } = await pendingPrint.run(note, win)
    const { error } = await supabase.from('communications').insert([{
      type: 'print', subject, student_id: studentId, attachment_filename: filename, pdf_base64: base64,
    }])
    if (error) console.warn('Failed to log printed letter:', error.message)
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

  const dataWarningBanner = dataWarnings.length > 0 && (
    <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg px-4 py-2.5 flex items-start justify-between gap-3">
      <div>
        <p className="font-medium">Some data on this page failed to load — balances below may be understated.</p>
        <ul className="list-disc list-inside mt-1">
          {dataWarnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      </div>
      <button onClick={() => load()} className="shrink-0 text-red-700 hover:text-red-900 font-medium underline">Retry</button>
    </div>
  )

  // Building Fund panel operates on the same "current plan" TuitionSection
  // uses elsewhere: active status wins, else the most recently created plan.
  const currentPlan = plans.find(p => p.status === 'active') || plans[0]
  const currentPlanPayments = currentPlan ? payments.filter(p => p.tuition_plan_id === currentPlan.id) : []
  const bfBal = currentPlan ? planBalances(currentPlan, currentPlanPayments) : null
  const bfPayments = currentPlanPayments.filter(p => p.payment_type === 'building_fund')
  const bfFullyForgiven = currentPlan?.building_fund_waived ||
    (bfPayments.length > 0 && (bfBal?.buildingFundBalance ?? 0) <= 0.005 &&
      bfPayments.filter(p => COUNTS_AS_PAID.includes(p.status)).every(p => p.status === 'forgiven'))

  // Current plan first so IncomingSolaPayments defaults an inline import to it.
  const plansForSolaReview = currentPlan ? [currentPlan, ...plans.filter(p => p.id !== currentPlan.id)] : plans

  const phoneSchedules = schedules.filter(s => s.purpose === 'phone_charge')
  const tuitionSchedule = schedules.find(s => s.purpose === 'tuition' && s.status === 'active')
  const buildingFundSchedule = schedules.find(s => s.purpose === 'building_fund' && s.status === 'active')
  const activeSchedules = schedules.filter(s => s.status === 'active')

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

      {dataWarningBanner}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-blue-100 p-2.5 rounded-xl">
            <GraduationCap size={22} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{student.first_name} {student.last_name}</h1>
            <p className="text-sm text-slate-500">
              {currentGradeLevel(student.grade_level, student.came_semester)}
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
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowChargeModal(true)}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
          >
            <CreditCard size={16} />
            Charge Now
          </button>
          <button
            onClick={() => setShowRecurringModal(true)}
            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            <Repeat size={16} />
            Recurring / Payment Plan
          </button>
          <button
            onClick={openAddPlan}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Add Plan
          </button>
        </div>
      </div>

      <IncomingSolaPayments
        payments={pendingSolaPayments}
        type="student"
        plans={plansForSolaReview}
        onResolved={() => { loadPendingSolaPayments(); load() }}
      />

      {showChargeModal && (
        <ChargeModal
          onClose={() => setShowChargeModal(false)}
          type="student"
          id={studentId}
          purposeOptions={[
            { value: 'tuition', label: 'Tuition' },
            { value: 'building_fund', label: 'Building Fund' },
            { value: 'registration_fee', label: 'Registration Fee' },
            { value: 'phone_charge', label: 'Phone Charge' },
            { value: 'donation', label: 'Donation' },
          ]}
          savedMethods={savedPaymentMethods}
          onCharged={load}
        />
      )}
      {showRecurringModal && (
        <RecurringModal
          onClose={() => setShowRecurringModal(false)}
          type="student"
          id={studentId}
          purposeOptions={[
            { value: 'tuition', label: 'Tuition' },
            { value: 'building_fund', label: 'Building Fund' },
            { value: 'phone_charge', label: 'Phone Charge' },
            { value: 'donation', label: 'Donation' },
          ]}
          savedMethods={savedPaymentMethods}
          onCreated={load}
          remainingBalances={bfBal ? { tuition: bfBal.tuitionBalance, building_fund: bfBal.buildingFundBalance } : undefined}
        />
      )}
      {showPhoneRecurringModal && (
        <RecurringModal
          onClose={() => setShowPhoneRecurringModal(false)}
          type="student"
          id={studentId}
          purposeOptions={[{ value: 'phone_charge', label: 'Phone Charge (Landline)' }]}
          savedMethods={savedPaymentMethods}
          defaultAmount={15}
          onCreated={load}
        />
      )}
      {manageScheduleId && (
        <ManageRecurringModal
          onClose={() => setManageScheduleId(null)}
          type="student"
          schedules={activeSchedules}
          savedMethods={savedPaymentMethods}
          initialScheduleId={manageScheduleId}
          onChanged={load}
        />
      )}
      {recalcTarget && (
        <RecalculateScheduleModal
          onClose={() => setRecalcTarget(null)}
          onDone={load}
          studentId={studentId}
          purpose={recalcTarget.purpose}
          purposeLabel={recalcTarget.purposeLabel}
          schedule={recalcTarget.schedule}
          remainingBalance={recalcTarget.remainingBalance}
        />
      )}

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

      {/* Registration Fee — one-time flat fee tracked on the student (not tied
          to a plan/year), rose-accented throughout so it's never mistaken
          for a tuition or building fund payment. Balance/history is derived
          from its own 'registration_fee' payment rows, same as building fund. */}
      {(() => {
        const regBal = regFeeBalances(student, payments)
        const fullyForgiven = regBal.regFeePayments.length > 0 && regBal.balance <= 0.005 &&
          regBal.regFeePayments.filter(p => COUNTS_AS_PAID.includes(p.status)).every(p => p.status === 'forgiven')
        return (
          <div className="bg-white rounded-xl shadow-sm border border-rose-100 overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-3 p-4">
              <div className="flex items-center gap-2.5">
                <Receipt size={16} className="text-rose-400 shrink-0" />
                <span className="text-sm font-medium text-slate-700">Registration Fee</span>
                {!student.registration_fee_status && (
                  <span className="text-sm text-slate-400">Not on file</span>
                )}
                {student.registration_fee_status && (
                  <span className="text-sm text-slate-500">
                    {formatCurrency(regBal.charge)} charge · Paid <span className="text-green-600 font-medium">{formatCurrency(regBal.paid)}</span>
                    {' · '}
                    {fullyForgiven ? (
                      <span className="text-purple-600 font-medium">Forgiven</span>
                    ) : regBal.balance > 0.005 ? (
                      <span className="text-red-600 font-medium">{formatCurrency(regBal.balance)} remaining</span>
                    ) : (
                      <span className="text-green-600 font-medium">Paid in Full</span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!student.registration_fee_status && (
                  <>
                    <button onClick={() => addRegistrationFee(250)}
                      title="Standard rate for a new student's first enrollment"
                      className="flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-rose-50 transition-colors">
                      <Plus size={13} /> Add $250 (New Student)
                    </button>
                    <button onClick={() => addRegistrationFee(75)}
                      title="Current-year rate for a returning student on the updated tuition contract"
                      className="flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-rose-50 transition-colors">
                      <Plus size={13} /> Add $75 (Returning)
                    </button>
                    <button onClick={() => addRegistrationFee(50)}
                      title="For a returning student's family paying before the September 1 early-registration cutoff"
                      className="flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-rose-50 transition-colors">
                      <Plus size={13} /> Add $50 (before Sep 1)
                    </button>
                  </>
                )}
                {student.registration_fee_status && (
                  <button onClick={() => openAddPayment(REG_FEE_KEY)}
                    className="flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-rose-50 transition-colors">
                    <Plus size={13} /> Add Payment
                  </button>
                )}
                {student.registration_fee_status && !fullyForgiven && regBal.balance > 0.005 && (
                  <button onClick={() => forgiveRegistrationFee(regBal.balance)}
                    className="text-xs text-slate-400 hover:text-slate-600 font-medium px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
                    Forgive Entire Registration Fee
                  </button>
                )}
                {student.registration_fee_status && regBal.regFeePayments.length === 0 && (
                  <button onClick={removeRegistrationFee}
                    className="text-xs text-slate-400 hover:text-slate-600 font-medium px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
                    Remove
                  </button>
                )}
              </div>
            </div>

            {student.registration_fee_status && (
              <div className="px-4 pb-4">
                {showAddPayment === REG_FEE_KEY && (
                  <PaymentForm
                    form={paymentForm}
                    setForm={setPaymentForm}
                    onSubmit={savePayment}
                    onCancel={() => { setShowAddPayment(null); setEditingPayment(null) }}
                    editing={!!editingPayment}
                    saving={savingPayment}
                    remainingBalance={regBal.balance}
                    lockedType="registration_fee"
                  />
                )}

                {regBal.regFeePayments.length === 0 ? (
                  <p className="text-xs text-slate-400 py-1">No payments recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="pb-2 text-left text-xs font-medium text-slate-400">Paid Date</th>
                          <th className="pb-2 text-right text-xs font-medium text-slate-400">Amount</th>
                          <th className="pb-2 text-left text-xs font-medium text-slate-400 pl-3">Status</th>
                          <th className="pb-2 text-left text-xs font-medium text-slate-400 hidden md:table-cell">Method</th>
                          <th className="pb-2 w-14" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {regBal.regFeePayments.map(pay => (
                          <tr key={pay.id} className="hover:bg-slate-50">
                            <td className="py-2 text-slate-600">
                              {pay.payment_date ? new Date(pay.payment_date).toLocaleDateString() : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="py-2 text-right font-medium text-slate-900">{formatCurrency(Number(pay.amount))}</td>
                            <td className="py-2 pl-3">
                              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(pay.status)}`}>
                                {planStatusIcon(pay.status)}
                                {statusLabel(pay.status)}
                              </span>
                            </td>
                            <td className="py-2 text-xs text-slate-400 hidden md:table-cell">
                              {paymentMethodLabel(pay.payment_method)}
                              {pay.transaction_id && <span className="ml-1 text-slate-300">#{pay.transaction_id}</span>}
                            </td>
                            <td className="py-2">
                              <div className="flex items-center gap-1 justify-end">
                                {COUNTS_AS_PAID.includes(pay.status) && (
                                  <>
                                    <button onClick={() => printRegFeeReceipt(pay)} className="p-1 text-slate-300 hover:text-rose-600 transition-colors" title="View receipt">
                                      <Receipt size={13} />
                                    </button>
                                    <button onClick={() => emailRegFeeReceipt(pay)} className="p-1 text-slate-300 hover:text-rose-600 transition-colors" title="Email receipt">
                                      <Mail size={13} />
                                    </button>
                                  </>
                                )}
                                <button onClick={() => openEditPayment(pay)} className="p-1 text-slate-300 hover:text-rose-600 transition-colors" title="Edit">
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
            )}
          </div>
        )
      })()}

      {/* Phone Charge — a plan-independent recurring fee (same shape as
          Registration Fee) but billed automatically via a real Sola
          recurring schedule instead of one-time staff-recorded payments —
          "Set Up" starts the card charging itself every month on Sola's own
          clock until "Stop" cancels it (or the student is marked graduated,
          which cancels it automatically — see StudentEditForm). Sky-accented
          so it's never mistaken for the other fee types. */}
      {(() => {
        const phoneBal = phoneChargeTotals(payments)
        const activeSchedule = phoneSchedules.find(s => s.status === 'active')
        return (
          <div className="bg-white rounded-xl shadow-sm border border-sky-100 overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-3 p-4">
              <div className="flex items-center gap-2.5">
                <Phone size={16} className="text-sky-400 shrink-0" />
                <span className="text-sm font-medium text-slate-700">Phone Charge (Landline)</span>
                {activeSchedule ? (
                  <span className="text-sm text-slate-500">
                    {scheduleCadenceLabel(activeSchedule)} since {new Date(activeSchedule.start_date + 'T00:00:00').toLocaleDateString()}
                    {' · '}
                    <span className="text-green-600 font-medium">Active</span>
                  </span>
                ) : phoneSchedules.length > 0 ? (
                  <span className="text-sm text-slate-500">
                    Stopped · {formatCurrency(phoneBal.paid)} collected total
                  </span>
                ) : (
                  <span className="text-sm text-slate-400">Not set up</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeSchedule ? (
                  <button onClick={() => setManageScheduleId(activeSchedule.id)}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-sky-600 font-medium px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors">
                    <Repeat size={13} /> Manage
                  </button>
                ) : (
                  <button onClick={() => setShowPhoneRecurringModal(true)}
                    className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors">
                    <Repeat size={13} /> Set Up Recurring $15/mo
                  </button>
                )}
                <button onClick={() => openAddPayment(PHONE_CHARGE_KEY)}
                  className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors">
                  <Plus size={13} /> Add Payment
                </button>
              </div>
            </div>

            <div className="px-4 pb-4">
              {showAddPayment === PHONE_CHARGE_KEY && (
                <PaymentForm
                  form={paymentForm}
                  setForm={setPaymentForm}
                  onSubmit={savePayment}
                  onCancel={() => { setShowAddPayment(null); setEditingPayment(null) }}
                  editing={!!editingPayment}
                  saving={savingPayment}
                  lockedType="phone_charge"
                />
              )}

              {phoneBal.phoneChargePayments.length === 0 ? (
                <p className="text-xs text-slate-400 py-1">No charges recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="pb-2 text-left text-xs font-medium text-slate-400">Paid Date</th>
                        <th className="pb-2 text-right text-xs font-medium text-slate-400">Amount</th>
                        <th className="pb-2 text-left text-xs font-medium text-slate-400 pl-3">Status</th>
                        <th className="pb-2 text-left text-xs font-medium text-slate-400 hidden md:table-cell">Method</th>
                        <th className="pb-2 w-14" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {phoneBal.phoneChargePayments.map(pay => (
                        <tr key={pay.id} className="hover:bg-slate-50">
                          <td className="py-2 text-slate-600">
                            {pay.payment_date ? new Date(pay.payment_date).toLocaleDateString() : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-2 text-right font-medium text-slate-900">{formatCurrency(Number(pay.amount))}</td>
                          <td className="py-2 pl-3">
                            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(pay.status)}`}>
                              {planStatusIcon(pay.status)}
                              {statusLabel(pay.status)}
                            </span>
                          </td>
                          <td className="py-2 text-xs text-slate-400 hidden md:table-cell">
                            {paymentMethodLabel(pay.payment_method)}
                            {pay.transaction_id && <span className="ml-1 text-slate-300">#{pay.transaction_id}</span>}
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-1 justify-end">
                              {COUNTS_AS_PAID.includes(pay.status) && (
                                <>
                                  <button onClick={() => printPhoneChargeReceipt(pay)} className="p-1 text-slate-300 hover:text-sky-600 transition-colors" title="View receipt">
                                    <Receipt size={13} />
                                  </button>
                                  <button onClick={() => emailPhoneChargeReceipt(pay)} className="p-1 text-slate-300 hover:text-sky-600 transition-colors" title="Email receipt">
                                    <Mail size={13} />
                                  </button>
                                </>
                              )}
                              <button onClick={() => openEditPayment(pay, PHONE_CHARGE_KEY)} className="p-1 text-slate-300 hover:text-sky-600 transition-colors" title="Edit">
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
        )
      })()}

      {/* Building Fund — a per-plan charge (unlike registration fee) but
          given the same prominent, dedicated panel: amber-accented so it's
          never mistaken for tuition (blue) or registration fee (rose).
          Forgiving it here just sets the same building_fund_waived flag the
          tuition statement PDF already respects — nothing about what prints
          on the statement changes, this only makes it easier to manage. */}
      {currentPlan && (bfBal!.buildingFund > 0 || currentPlan.building_fund_waived || bfPayments.length > 0) && (
        <div className="bg-white rounded-xl shadow-sm border border-amber-100 overflow-hidden">
          <div className="flex items-center justify-between flex-wrap gap-3 p-4">
            <div className="flex items-center gap-2.5">
              <Receipt size={16} className="text-amber-400 shrink-0" />
              <span className="text-sm font-medium text-slate-700">Building Fund</span>
              <span className="text-xs text-slate-400">({currentPlan.academic_year})</span>
              <span className="text-sm text-slate-500 flex items-center gap-1.5">
                {editingBFAmount ? (
                  <>
                    <input type="number" step="0.01" min="0" autoFocus value={bfAmountInput}
                      onChange={e => setBfAmountInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveBuildingFundAmount(currentPlan.id) }}
                      className="w-24 border border-amber-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    <button onClick={() => saveBuildingFundAmount(currentPlan.id)} className="text-amber-600 hover:text-amber-700"><Check size={15} /></button>
                    <button onClick={() => setEditingBFAmount(false)} className="text-slate-400 hover:text-slate-600"><X size={15} /></button>
                  </>
                ) : (
                  <>
                    {formatCurrency(bfBal!.buildingFund)} charge
                    <button onClick={() => { setBfAmountInput(String(currentPlan.building_fund_amount ?? 0)); setEditingBFAmount(true) }}
                      className="text-slate-300 hover:text-amber-600" title="Alter amount">
                      <Edit2 size={12} />
                    </button>
                  </>
                )}
                {' · '}Paid <span className="text-green-600 font-medium">{formatCurrency(bfBal!.buildingFundPaid)}</span>
                {' · '}
                {bfFullyForgiven ? (
                  <span className="text-purple-600 font-medium">Forgiven</span>
                ) : bfBal!.buildingFundBalance > 0.005 ? (
                  <span className="text-red-600 font-medium">{formatCurrency(bfBal!.buildingFundBalance)} remaining</span>
                ) : (
                  <span className="text-green-600 font-medium">Paid in Full</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => openAddPayment(bfKey(currentPlan.id), { payment_type: 'building_fund' })}
                className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-amber-50 transition-colors">
                <Plus size={13} /> Add Payment
              </button>
              <button onClick={() => toggleBuildingFundWaived(currentPlan.id, !currentPlan.building_fund_waived)}
                className="text-xs text-slate-400 hover:text-slate-600 font-medium px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
                {currentPlan.building_fund_waived ? 'Un-forgive' : 'Forgive Entire Building Fund'}
              </button>
            </div>
          </div>

          <div className="px-4 pb-4">
            {showAddPayment === bfKey(currentPlan.id) && (
              <PaymentForm
                form={paymentForm}
                setForm={setPaymentForm}
                onSubmit={savePayment}
                onCancel={() => { setShowAddPayment(null); setEditingPayment(null) }}
                editing={!!editingPayment}
                saving={savingPayment}
                remainingBalance={bfBal!.buildingFundBalance}
                lockedType="building_fund"
              />
            )}

            {bfPayments.length === 0 ? (
              <p className="text-xs text-slate-400 py-1">No payments recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="pb-2 text-left text-xs font-medium text-slate-400">Paid Date</th>
                      <th className="pb-2 text-right text-xs font-medium text-slate-400">Amount</th>
                      <th className="pb-2 text-left text-xs font-medium text-slate-400 pl-3">Status</th>
                      <th className="pb-2 text-left text-xs font-medium text-slate-400 hidden md:table-cell">Method</th>
                      <th className="pb-2 w-14" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {bfPayments.map(pay => (
                      <tr key={pay.id} className="hover:bg-slate-50">
                        <td className="py-2 text-slate-600">
                          {pay.payment_date ? new Date(pay.payment_date).toLocaleDateString() : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-2 text-right font-medium text-slate-900">{formatCurrency(Number(pay.amount))}</td>
                        <td className="py-2 pl-3">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(pay.status)}`}>
                            {planStatusIcon(pay.status)}
                            {statusLabel(pay.status)}
                          </span>
                        </td>
                        <td className="py-2 text-xs text-slate-400 hidden md:table-cell">
                          {paymentMethodLabel(pay.payment_method)}
                          {pay.transaction_id && <span className="ml-1 text-slate-300">#{pay.transaction_id}</span>}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-1 justify-end">
                            {COUNTS_AS_PAID.includes(pay.status) && (
                              <>
                                <button onClick={() => printReceipt(currentPlan, pay)} className="p-1 text-slate-300 hover:text-amber-600 transition-colors" title="View receipt">
                                  <Receipt size={13} />
                                </button>
                                <button onClick={() => emailReceipt(currentPlan, pay)} className="p-1 text-slate-300 hover:text-amber-600 transition-colors" title="Email receipt">
                                  <Mail size={13} />
                                </button>
                              </>
                            )}
                            <button onClick={() => openEditPayment(pay, bfKey(currentPlan.id))} className="p-1 text-slate-300 hover:text-amber-600 transition-colors" title="Edit">
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

      {/* Donations — from this student's linked parent(s), kept entirely
          separate from tuition/building fund/registration fee: a different
          table, a different color (emerald, vs. the blue/amber/rose used
          above), and never folded into any balance figure on this page. */}
      {parentDonations.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-emerald-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-emerald-100 bg-emerald-50">
            <div className="flex items-center gap-2">
              <Heart size={15} className="text-emerald-600" />
              <p className="text-sm font-semibold text-emerald-900">Donations</p>
              <span className="text-xs text-emerald-600">from this student&apos;s parent(s) — separate from tuition</span>
            </div>
            <span className="text-sm font-bold text-emerald-700">
              {formatCurrency(parentDonations.reduce((s, d) => s + Number(d.amount), 0))} total
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400">
                  <th className="text-left px-5 py-2 font-medium text-xs">Donor</th>
                  <th className="text-left px-5 py-2 font-medium text-xs">Date</th>
                  <th className="text-left px-5 py-2 font-medium text-xs">Category</th>
                  <th className="text-right px-5 py-2 font-medium text-xs">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {parentDonations.map(d => (
                  <tr key={d.id} className="hover:bg-emerald-50/50">
                    <td className="px-5 py-2">
                      {d.donors ? (
                        <Link href={`/admin/donors/${d.donor_id}`} className="text-emerald-700 hover:text-emerald-800 font-medium">{d.donors.name}</Link>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-2 text-slate-600">{new Date(d.donation_date + 'T00:00:00').toLocaleDateString()}</td>
                    <td className="px-5 py-2 text-slate-500">{d.events?.name ?? donationCategoryLabel(d.category) ?? '—'}</td>
                    <td className="px-5 py-2 text-right font-semibold text-emerald-700">{formatCurrency(Number(d.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TuitionDocumentsPanel studentId={studentId} />

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
            const backfillMonths = unpaidMonths(plan, planPayments)

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
                      {planIsUpcoming(plan) && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700" title="This plan's semester hasn't started yet — everything works normally, it just hasn't begun.">
                          Upcoming
                        </span>
                      )}
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
                      {plan.id === currentPlan?.id && tuitionSchedule && (
                        <span className="inline-flex items-center gap-2 text-blue-600 font-medium">
                          <span className="inline-flex items-center gap-1"><Repeat size={12} /> {scheduleCadenceLabel(tuitionSchedule)}</span>
                          <button onClick={e => { e.stopPropagation(); setManageScheduleId(tuitionSchedule.id) }}
                            className="text-slate-400 hover:text-blue-600 font-normal underline">
                            Manage
                          </button>
                        </span>
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
                        {plan.id === currentPlan?.id && buildingFundSchedule && (
                          <span className="inline-flex items-center gap-2 text-blue-600 font-medium">
                            <span className="inline-flex items-center gap-1"><Repeat size={12} /> {scheduleCadenceLabel(buildingFundSchedule)}</span>
                            <button onClick={e => { e.stopPropagation(); setManageScheduleId(buildingFundSchedule.id) }}
                              className="text-slate-400 hover:text-blue-600 font-normal underline">
                              Manage
                            </button>
                          </span>
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
                    {plan.id === currentPlan?.id && tuitionSchedule && scheduleNeedsRecalc(tuitionSchedule, planPayments, 'tuition') && (
                      <div className="mt-2 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                        <AlertCircle size={13} className="shrink-0" />
                        <span className="flex-1">
                          A manual tuition payment was recorded since this recurring schedule started — its {formatCurrency(tuitionSchedule.amount)}{' '}
                          {tuitionSchedule.interval_count === 1 ? `per ${tuitionSchedule.interval_type}` : `every ${tuitionSchedule.interval_count} ${tuitionSchedule.interval_type}s`} payment
                          may no longer match the {formatCurrency(bal.tuitionBalance)} still owed.
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); setRecalcTarget({ purpose: 'tuition', purposeLabel: 'Tuition', schedule: tuitionSchedule, remainingBalance: bal.tuitionBalance }) }}
                          className="shrink-0 font-semibold text-amber-900 hover:text-amber-950 underline"
                        >
                          Recalculate
                        </button>
                      </div>
                    )}
                    {plan.id === currentPlan?.id && buildingFundSchedule && scheduleNeedsRecalc(buildingFundSchedule, planPayments, 'building_fund') && (
                      <div className="mt-2 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                        <AlertCircle size={13} className="shrink-0" />
                        <span className="flex-1">
                          A manual building fund payment was recorded since this recurring schedule started — its {formatCurrency(buildingFundSchedule.amount)}{' '}
                          {buildingFundSchedule.interval_count === 1 ? `per ${buildingFundSchedule.interval_type}` : `every ${buildingFundSchedule.interval_count} ${buildingFundSchedule.interval_type}s`} payment
                          may no longer match the {formatCurrency(bal.buildingFundBalance)} still owed.
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); setRecalcTarget({ purpose: 'building_fund', purposeLabel: 'Building Fund', schedule: buildingFundSchedule, remainingBalance: bal.buildingFundBalance }) }}
                          className="shrink-0 font-semibold text-amber-900 hover:text-amber-950 underline"
                        >
                          Recalculate
                        </button>
                      </div>
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

                    {/* Backfill — past/unpaid months for yearly-billed plans */}
                    {backfillMonths.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200 bg-white">
                          <CalendarCheck size={14} className="text-amber-600" />
                          <p className="text-sm font-semibold text-amber-900">Unpaid Months</p>
                          <span className="text-xs text-amber-600 ml-auto">Record a backdated payment against any month below</span>
                        </div>
                        <div className="divide-y divide-amber-100">
                          {backfillMonths.map(m => (
                            <div key={m.monthKey} className="flex items-center justify-between px-4 py-2 gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.isPast ? 'bg-red-400' : 'bg-amber-300'}`} />
                                <span className="text-sm text-slate-700 truncate">{m.label}</span>
                                <span className="text-xs text-slate-400">
                                  {m.paidSoFar > 0
                                    ? `${formatCurrency(m.remaining)} remaining of ${formatCurrency(m.amount)}`
                                    : `${formatCurrency(m.amount)} due`}
                                </span>
                              </div>
                              <button
                                onClick={() => openAddPayment(plan.id, { payment_type: 'tuition', period_month: m.monthKey, amount: m.remaining.toFixed(2) })}
                                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors flex-shrink-0"
                              >
                                <Plus size={12} /> Record Payment
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

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
                        <PaymentForm
                          form={paymentForm}
                          setForm={setPaymentForm}
                          onSubmit={savePayment}
                          onCancel={() => { setShowAddPayment(null); setEditingPayment(null) }}
                          editing={!!editingPayment}
                          saving={savingPayment}
                          remainingBalance={paymentForm.payment_type === 'building_fund' ? bal.buildingFundBalance : bal.tuitionBalance}
                          monthOptions={paymentForm.payment_type === 'tuition' ? backfillMonths : undefined}
                        />
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
                                    {pay.period_month && (
                                      <span className="block text-xs text-blue-500">
                                        For {new Date(pay.period_month + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 text-right font-medium text-slate-900">{formatCurrency(Number(pay.amount))}</td>
                                  <td className="py-2 pl-3">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(pay.status)}`}>
                                        {planStatusIcon(pay.status)}
                                        {statusLabel(pay.status)}
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
                                      {COUNTS_AS_PAID.includes(pay.status) && (
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

                    <TuitionDocumentsPanel studentId={studentId} tuitionPlanId={plan.id} academicYear={plan.academic_year} />
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
      {pendingPrint && (
        <PrintNoteModal
          title={pendingPrint.title}
          onConfirm={confirmPendingPrint}
          onClose={() => setPendingPrint(null)}
        />
      )}
    </div>
  )
}
