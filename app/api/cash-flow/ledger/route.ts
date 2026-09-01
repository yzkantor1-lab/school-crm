import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type TxType = 'tuition' | 'registration_fee' | 'building_fund' | 'phone_charge' | 'donation' | 'pledge_payment' | 'expense'

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

    return NextResponse.json(tx)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load cash flow data'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
