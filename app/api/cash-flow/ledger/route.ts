import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type TxType = 'tuition' | 'registration_fee' | 'building_fund' | 'phone_charge' | 'donation' | 'pledge_payment' | 'expense'
type ScheduleType = 'tuition' | 'building_fund' | 'phone_charge' | 'donation'

type Transaction = {
  id: string
  date: string
  type: TxType
  direction: 'in' | 'out'
  amount: number
  label: string
  subLabel: string
  href?: string
}

type ProjectionMonth = {
  key: string
  label: string
  byType: Partial<Record<ScheduleType, number>>
  total: number
}

const CATEGORY_LABEL: Record<string, string> = {
  monthly_recurring: 'Monthly Recurring',
  one_time: 'One-Time',
  event: 'Event',
}

// Mirrors TYPE_META's labels on the Cash Flow page — kept in sync there for
// badge styling, duplicated here (label text only) since this route has no
// UI concerns of its own.
const TYPE_LABEL: Record<TxType, string> = {
  tuition: 'Tuition',
  registration_fee: 'Registration Fee',
  building_fund: 'Building Fund',
  phone_charge: 'Phone Charge',
  donation: 'Donation',
  pledge_payment: 'Pledge Payment',
  expense: 'Expense',
}

// Runs server-side (Vercel talking to Supabase) rather than the browser
// talking to Supabase directly — some school network content filters do
// SSL inspection on *.supabase.co and mangle the CORS headers on any
// request whose URL text contains "payment" (this page's queries can't
// avoid that: pledge_payments/tuition_payments embeds reference
// payment_date/payment_type by name). Routing through our own domain
// dodges it entirely, since GenTech-class filters here are keyed off the
// request URL, not the response body. See the Cash-Flow-page git history
// for the client-side embed trick this route replaces for that reason.
async function selectAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await query(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return rows
}

function addInterval(d: Date, intervalType: string, intervalCount: number): Date {
  const nd = new Date(d)
  if (intervalType === 'day') nd.setDate(nd.getDate() + intervalCount)
  else if (intervalType === 'week') nd.setDate(nd.getDate() + intervalCount * 7)
  else if (intervalType === 'year') nd.setFullYear(nd.getFullYear() + intervalCount)
  else nd.setMonth(nd.getMonth() + intervalCount) // 'month' (and unrecognized values default here)
  return nd
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

// Projects three sources of committed monthly income forward across the next
// 12 calendar months, independent of the ledger's own date-range filter —
// this is about what's coming, not what already happened:
//
//  1. Active Sola recurring schedules (payment_schedules) — walks each
//     schedule's full theoretical occurrence sequence from its start_date
//     (respecting total_payments as a hard cap on fixed-length payment
//     plans) rather than trying to infer "payments remaining" — Sola is the
//     only source of truth for what's actually run so far, and calling it
//     live for every schedule just to draw this chart isn't worth the
//     latency.
//  2. Tuition plans on a monthly schedule that AREN'T billed through Sola
//     (payment_amount set on tuition_plans, but no active Sola schedule for
//     that student) — a family paying by check/cash/etc. on their own, or
//     one whose Sola auto-charge hasn't been set up yet. Skipped for any
//     student who already has an active Sola tuition schedule, so a plan
//     that *is* wired up to Sola doesn't get counted twice.
//  3. Recurring donations tracked outside Sola (recurring_donations) — same
//     idea, for donors giving by check/etc. on a standing arrangement.
type ScheduleSource = {
  purpose: string; amount: number; interval_type: string; interval_count: number
  total_payments: number | null; start_date: string
}
type TuitionPlanSource = { amount: number; start_date: string | null; end_date: string | null }
type RecurringDonationSource = {
  amount: number; frequency: string; total_months: number | null
  start_date: string; end_date: string | null
}

function buildProjection(
  schedules: ScheduleSource[],
  manualTuitionPlans: TuitionPlanSource[],
  manualRecurringDonations: RecurringDonationSource[],
  monthsAhead: number
): { months: ProjectionMonth[]; totalsByType: Partial<Record<ScheduleType, number>>; total: number } {
  const horizonStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const horizonEnd = new Date(horizonStart.getFullYear(), horizonStart.getMonth() + monthsAhead, 0)

  const months: ProjectionMonth[] = []
  for (let i = 0; i < monthsAhead; i++) {
    const d = new Date(horizonStart.getFullYear(), horizonStart.getMonth() + i, 1)
    const key = d.toISOString().slice(0, 7)
    months.push({ key, label: monthLabel(key), byType: {}, total: 0 })
  }
  const monthIndex = new Map(months.map(m => [m.key, m]))

  const totalsByType: Partial<Record<ScheduleType, number>> = {}
  let total = 0

  function add(type: ScheduleType, amount: number, atMonthStart: Date) {
    const bucket = monthIndex.get(atMonthStart.toISOString().slice(0, 7))
    if (!bucket) return
    bucket.byType[type] = (bucket.byType[type] ?? 0) + amount
    bucket.total += amount
    totalsByType[type] = (totalsByType[type] ?? 0) + amount
    total += amount
  }

  for (const s of schedules) {
    const type = s.purpose as ScheduleType
    if (!['tuition', 'building_fund', 'phone_charge', 'donation'].includes(type)) continue

    let cur = new Date(`${s.start_date}T00:00:00`)
    let count = 0
    const cap = s.total_payments ?? Infinity
    let iterations = 0
    while (count < cap && cur <= horizonEnd && iterations < 2000) {
      if (cur >= horizonStart) add(type, s.amount, new Date(cur.getFullYear(), cur.getMonth(), 1))
      cur = addInterval(cur, s.interval_type, s.interval_count)
      count++
      iterations++
    }
  }

  for (const p of manualTuitionPlans) {
    const planStart = p.start_date ? new Date(`${p.start_date}T00:00:00`) : null
    const planEnd = p.end_date ? new Date(`${p.end_date}T00:00:00`) : null
    for (const m of months) {
      const monthStart = new Date(`${m.key}-01T00:00:00`)
      if (planStart && monthStart < new Date(planStart.getFullYear(), planStart.getMonth(), 1)) continue
      if (planEnd && monthStart > planEnd) continue
      add('tuition', p.amount, monthStart)
    }
  }

  for (const r of manualRecurringDonations) {
    const intervalType = r.frequency === 'yearly' ? 'year' : r.frequency === 'quarterly' ? 'quarter' : 'month'
    let cur = new Date(`${r.start_date}T00:00:00`)
    let count = 0
    const cap = r.total_months != null
      ? Math.ceil(r.total_months / (intervalType === 'year' ? 12 : intervalType === 'quarter' ? 3 : 1))
      : Infinity
    let iterations = 0
    while (count < cap && cur <= horizonEnd && iterations < 2000) {
      if (cur >= horizonStart && (!r.end_date || cur <= new Date(`${r.end_date}T00:00:00`))) {
        add('donation', r.amount, new Date(cur.getFullYear(), cur.getMonth(), 1))
      }
      cur = intervalType === 'quarter' ? addInterval(cur, 'month', 3) : addInterval(cur, intervalType, 1)
      count++
      iterations++
    }
  }

  return { months, totalsByType, total }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const startDate = searchParams.get('start') || ''
  const endDate = searchParams.get('end') || ''
  const includeArchived = searchParams.get('archived') === '1'

  try {
    const supabase = await createClient()

    const donationRows = await selectAll<{
      id: string; amount: number; donation_date: string; purpose: string
      category: string | null; archived: boolean
      donors: { id: string; name: string } | null
    }>((from, to) => {
      let q = supabase.from('donations')
        .select('id, amount, donation_date, purpose, category, archived, donors(id, name)')
        .order('id', { ascending: true })
        .range(from, to)
      if (startDate) q = q.gte('donation_date', startDate)
      if (endDate) q = q.lte('donation_date', endDate)
      if (!includeArchived) q = q.eq('archived', false)
      return q
    })

    const pledgeRows = await selectAll<{
      id: string; purpose: string | null; donors: { name: string } | null
      pledge_payments: { id: string; amount: number; payment_date: string | null }[] | null
    }>((from, to) =>
      supabase.from('pledges')
        .select('id, purpose, donors(name), pledge_payments(id, amount, payment_date)')
        .order('id', { ascending: true })
        .range(from, to)
    )
    const pledgePaymentRows = pledgeRows.flatMap(p =>
      (p.pledge_payments || [])
        .filter(pp => pp.payment_date != null)
        .filter(pp => (!startDate || pp.payment_date! >= startDate) && (!endDate || pp.payment_date! <= endDate))
        .map(pp => ({ id: pp.id, amount: pp.amount, payment_date: pp.payment_date as string, pledges: { purpose: p.purpose, donors: p.donors } }))
    )

    const studentPaymentRows = await selectAll<{
      id: string; first_name: string; last_name: string
      tuition_payments: { id: string; amount: number; payment_date: string | null; payment_type: string; status: string }[] | null
    }>((from, to) =>
      supabase.from('students')
        .select('id, first_name, last_name, tuition_payments(id, amount, payment_date, payment_type, status)')
        .order('id', { ascending: true })
        .range(from, to)
    )
    const tuitionRows = studentPaymentRows.flatMap(s => {
      const student = { id: s.id, first_name: s.first_name, last_name: s.last_name }
      return (s.tuition_payments || [])
        .filter(t => ['paid', 'partial'].includes(t.status) && t.payment_date != null)
        .filter(t => (!startDate || t.payment_date! >= startDate) && (!endDate || t.payment_date! <= endDate))
        .map(t => ({ id: t.id, amount: t.amount, payment_date: t.payment_date as string, payment_type: t.payment_type, students: student }))
    })

    // payment_schedules — same URL-text problem as pledge_payments/
    // tuition_payments (the table name itself is "payment_schedules"), so
    // this has to be server-side too.
    const activeSchedules = await selectAll<{
      purpose: string; amount: number; interval_type: string; interval_count: number
      total_payments: number | null; start_date: string
      student_id: string | null; donor_id: string | null
    }>((from, to) =>
      supabase.from('payment_schedules')
        .select('purpose, amount, interval_type, interval_count, total_payments, start_date, student_id, donor_id')
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(from, to)
    )
    const scheduledTuitionStudentIds = new Set(
      activeSchedules.filter(s => s.purpose === 'tuition' && s.student_id).map(s => s.student_id)
    )
    const scheduledDonationDonorIds = new Set(
      activeSchedules.filter(s => s.purpose === 'donation' && s.donor_id).map(s => s.donor_id)
    )

    // Families on a monthly tuition plan that isn't billed through Sola
    // (checks, cash, etc., or Sola just hasn't been set up yet) — excludes
    // anyone with an active Sola tuition schedule so they aren't projected
    // twice.
    const manualTuitionPlanRows = await selectAll<{
      student_id: string; payment_amount: number; start_date: string | null; end_date: string | null
    }>((from, to) =>
      supabase.from('tuition_plans')
        .select('student_id, payment_amount, start_date, end_date')
        .eq('status', 'active')
        .eq('payment_structure', 'monthly')
        .not('payment_amount', 'is', null)
        .order('id', { ascending: true })
        .range(from, to)
    )
    const manualTuitionPlans = manualTuitionPlanRows
      .filter(p => !scheduledTuitionStudentIds.has(p.student_id))
      .map(p => ({ amount: Number(p.payment_amount), start_date: p.start_date, end_date: p.end_date }))

    // Recurring donations tracked outside Sola (same "checks/cash on a
    // standing arrangement" idea, for donors instead of families).
    const recurringDonationRows = await selectAll<{
      donor_id: string; amount: number; frequency: string
      total_months: number | null; start_date: string; end_date: string | null
    }>((from, to) =>
      supabase.from('recurring_donations')
        .select('donor_id, amount, frequency, total_months, start_date, end_date')
        .eq('active', true)
        .order('id', { ascending: true })
        .range(from, to)
    )
    const manualRecurringDonations = recurringDonationRows
      .filter(r => !scheduledDonationDonorIds.has(r.donor_id))
      .map(r => ({ amount: Number(r.amount), frequency: r.frequency, total_months: r.total_months, start_date: r.start_date, end_date: r.end_date }))

    const projection = buildProjection(activeSchedules, manualTuitionPlans, manualRecurringDonations, 12)

    const expenseRows = await selectAll<{
      id: string; amount: number; date: string; category: string
      description: string; vendor: string | null; archived: boolean
    }>((from, to) => {
      let q = supabase.from('expenses')
        .select('id, amount, date, category, description, vendor, archived')
        .order('id', { ascending: true })
        .range(from, to)
      if (startDate) q = q.gte('date', startDate)
      if (endDate) q = q.lte('date', endDate)
      if (!includeArchived) q = q.eq('archived', false)
      return q
    })

    const tx: Transaction[] = [
      ...donationRows.map(d => ({
        id: `donation-${d.id}`,
        date: d.donation_date,
        type: 'donation' as const,
        direction: 'in' as const,
        amount: Number(d.amount),
        label: d.donors?.name ?? 'Unknown Donor',
        subLabel: [d.purpose, d.category ? CATEGORY_LABEL[d.category] ?? d.category : null].filter(Boolean).join(' · '),
        href: d.donors?.id ? `/admin/donors/${d.donors.id}` : undefined,
      })),
      ...pledgePaymentRows.map(p => ({
        id: `pledge-${p.id}`,
        date: p.payment_date,
        type: 'pledge_payment' as const,
        direction: 'in' as const,
        amount: Number(p.amount),
        label: p.pledges?.donors?.name ?? 'Unknown Donor',
        subLabel: ['Pledge Payment', p.pledges?.purpose].filter(Boolean).join(' · '),
        href: '/admin/pledges',
      })),
      ...tuitionRows.map(t => {
        const type: TxType = t.payment_type === 'registration_fee' ? 'registration_fee'
          : t.payment_type === 'building_fund' ? 'building_fund'
          : t.payment_type === 'phone_charge' ? 'phone_charge'
          : t.payment_type === 'donation' ? 'donation'
          : 'tuition'
        return {
          id: `tuition-${t.id}`,
          date: t.payment_date,
          type,
          direction: 'in' as const,
          amount: Number(t.amount),
          label: t.students ? `${t.students.first_name} ${t.students.last_name}` : 'Unknown Student',
          subLabel: type === 'donation' ? 'Donation (family record)' : TYPE_LABEL[type],
          href: t.students?.id ? `/admin/tuition/${t.students.id}` : undefined,
        }
      }),
      ...expenseRows.map(e => ({
        id: `expense-${e.id}`,
        date: e.date,
        type: 'expense' as const,
        direction: 'out' as const,
        amount: Number(e.amount),
        label: e.category,
        subLabel: [e.description, e.vendor].filter(Boolean).join(' · '),
        href: '/admin/expenses',
      })),
    ]

    return NextResponse.json({ transactions: tx, projection })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load cash flow data'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
