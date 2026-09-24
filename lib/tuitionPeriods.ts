import { SCHOOL_YEAR_SEMESTERS } from '@/lib/semesters'
import { periodLabel, type Period } from '@/lib/periods'

// Per-period tuition math for the Tuition list page (app/(dashboard)/admin/
// tuition/page.tsx): which plan a student is shown with for a given school
// year / semester / all years, and the expected / paid / balance figures
// for that period. Kept free of React so it can be checked on its own.

export type Student = {
  id: string
  first_name: string | null
  last_name: string | null
  grade_level: string | null
  student_id: string | null
  status: string | null
  came_semester: string | null
}

export type TuitionPlan = {
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
  building_fund_waived: boolean | null
}

export type ActiveSchedule = {
  id: string
  purpose: string
  amount: number
  intervalType: string
  intervalCount: number
  totalPayments: number | null
  paymentMethodId: string | null
}

export type StudentWithTuition = Student & {
  // The plan shown for the selected period (for "All years", the newest).
  activePlan: TuitionPlan | null
  totalPaid: number
  balance: number
  // Positive balance sitting on an earlier academic year's plan than the one
  // being displayed — e.g. this year is paid in full but last year isn't.
  priorOutstandingAmount: number
  // Every active Sola recurring schedule billing this student, regardless of
  // purpose (tuition, building fund, phone charge) — not just the ones tied
  // to a fixed-#-of-payments plan. Lets staff see at a glance whether a
  // recurring charge was actually set up, instead of having to open each
  // student individually to check.
  activeSchedules: ActiveSchedule[]
  // Display/export labels for the Year / Plan column — the plan's own year
  // and structure, or a period summary ("All years" / "3 plans").
  activePlanYear: string
  activePlanStructure: string
  // Expected / paid / balance above are all scoped to the selected period.
  expected: number
  buildingFund: number
}

// There's no per-installment schedule in the data — payments are only ever
// logged once received, never as a pending/due row — so "outstanding by
// semester/month" is an estimate: each plan's total is spread evenly across
// the days of its date range (semester days only, for semester buckets —
// see semesterBucketsForPlan; weighted by how much of each bucket
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

export type PlanBucket = { key: string; label: string; sortKey: number; startDate: string; endDate: string; amount: number }

// Weighted by semester days only — the breaks between semesters (after Yom
// Kippur, Nissan–Iyar, summer) aren't billed time, so spreading over every
// calendar day of the plan would leave part of the plan in no semester and
// the semesters wouldn't add up to the plan's total.
export function semesterBucketsForPlan(plan: TuitionPlan, expected: number): PlanBucket[] {
  const range = planDateRange(plan)
  if (!range || expected <= 0) return []
  const withDays: { bucket: Omit<PlanBucket, 'amount'>; days: number }[] = []
  SCHOOL_YEAR_SEMESTERS.forEach((yearGroup, gi) => {
    yearGroup.semesters.forEach((sem, si) => {
      const days = overlapDays(range.start, range.end, sem.startDate, sem.endDate)
      if (days > 0) {
        withDays.push({
          days,
          bucket: {
            key: `${yearGroup.year}-s${si}`,
            label: `${yearGroup.year} · Semester ${si + 1}`,
            sortKey: gi * 10 + si,
            startDate: sem.startDate,
            endDate: sem.endDate,
          },
        })
      }
    })
  })
  const semesterDays = withDays.reduce((sum, w) => sum + w.days, 0)
  return withDays
    .map(w => ({ ...w.bucket, amount: expected * (w.days / semesterDays) }))
    .sort((a, b) => a.sortKey - b.sortKey)
}

export function monthBucketsForPlan(plan: TuitionPlan, expected: number): PlanBucket[] {
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
        endDate: monthEnd,
        amount: expected * (overlap / totalDays),
      })
    }
    cursor.setMonth(m + 1)
  }
  return buckets
}

// Applies `paid` to buckets oldest-first, leaving each bucket's unpaid remainder.
export function applyPaidWaterfall(buckets: PlanBucket[], paid: number): PlanBucket[] {
  let remainingPaid = paid
  return buckets.map(b => {
    const applied = Math.min(remainingPaid, b.amount)
    remainingPaid -= applied
    return { ...b, amount: b.amount - applied }
  })
}

export type RawSchedule = { id: string; student_id: string; purpose: string; amount: number; interval_type: string; interval_count: number; total_payments: number | null; payment_method_id: string | null }

export function planExpected(p: TuitionPlan): number {
  return Number(p.total_amount ?? 0) - Number(p.discount_amount ?? 0) + planBuildingFund(p)
}

export function planBuildingFund(p: TuitionPlan): number {
  return p.building_fund_waived ? 0 : Number(p.building_fund_amount ?? 0)
}

// Latest academic year first; an 'active' status only breaks a tie between
// plans from the same year — a stale 'active' flag on an old plan should
// never override a newer year's plan.
export function newestPlanFirst(a: TuitionPlan, b: TuitionPlan): number {
  const yearCmp = (b.academic_year || '').localeCompare(a.academic_year || '')
  if (yearCmp !== 0) return yearCmp
  return (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
}

// One student's row for the selected period, or null when they don't belong
// in it — a past year/semester only lists students who had a plan covering
// it; the current year (and "All years") also lists students with no plan
// yet, so staff can see who still needs one set up.
export function studentForPeriod(s: Student, studentPlans: TuitionPlan[], paidByPlan: Map<string, number>,
  activeSchedules: ActiveSchedule[], period: Period, currentYear: string): StudentWithTuition | null {
  const sorted = [...studentPlans].sort(newestPlanFirst)
  const paidOf = (p: TuitionPlan) => paidByPlan.get(p.id) ?? 0
  const outstandingOf = (p: TuitionPlan) => Math.max(0, planExpected(p) - paidOf(p))
  const base = { ...s, activeSchedules }

  if (period.kind === 'all') {
    const expected = sorted.reduce((sum, p) => sum + planExpected(p), 0)
    const totalPaid = sorted.reduce((sum, p) => sum + paidOf(p), 0)
    return {
      ...base, activePlan: sorted[0] ?? null, expected, totalPaid, balance: expected - totalPaid,
      buildingFund: sorted.reduce((sum, p) => sum + planBuildingFund(p), 0),
      priorOutstandingAmount: 0,
      activePlanYear: sorted.length ? 'All years' : '',
      activePlanStructure: sorted.length ? `${sorted.length} plan${sorted.length === 1 ? '' : 's'}` : '',
    }
  }

  const plan = sorted.find(p => p.academic_year === period.year) ?? null
  const priorOutstandingAmount = sorted
    .filter(p => p !== plan && (p.academic_year ?? '') < period.year)
    .reduce((sum, p) => sum + outstandingOf(p), 0)

  if (!plan) {
    if (period.kind !== 'year' || period.year !== currentYear) return null
    return {
      ...base, activePlan: null, expected: 0, totalPaid: 0, balance: 0, buildingFund: 0,
      priorOutstandingAmount, activePlanYear: '', activePlanStructure: '',
    }
  }

  if (period.kind === 'year') {
    const expected = planExpected(plan)
    const totalPaid = paidOf(plan)
    return {
      ...base, activePlan: plan, expected, totalPaid, balance: expected - totalPaid,
      buildingFund: planBuildingFund(plan), priorOutstandingAmount,
      activePlanYear: plan.academic_year ?? '', activePlanStructure: plan.payment_structure ?? '',
    }
  }

  // Semester: the plan's prorated share for that semester, with what's been
  // paid applied oldest-semester-first — the same estimate the "By Semester
  // Due" view uses (see the note at the top of this file). A plan that
  // doesn't cover that semester (e.g. the student started later) means
  // nothing was owed then, so the student isn't listed.
  const expectedTotal = planExpected(plan)
  const key = `${period.year}-s${period.index}`
  const bucket = semesterBucketsForPlan(plan, expectedTotal).find(b => b.key === key)
  if (!bucket || bucket.amount <= 0.005) return null
  const remaining = applyPaidWaterfall(semesterBucketsForPlan(plan, expectedTotal), paidOf(plan)).find(b => b.key === key)!.amount
  return {
    ...base, activePlan: plan, expected: bucket.amount, totalPaid: bucket.amount - remaining, balance: remaining,
    buildingFund: planBuildingFund(plan) * (bucket.amount / expectedTotal), priorOutstandingAmount,
    activePlanYear: periodLabel(period), activePlanStructure: plan.payment_structure ?? '',
  }
}
