'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react'
import ExportButton from '@/components/ExportButton'

type TxType = 'tuition' | 'registration_fee' | 'building_fund' | 'phone_charge' | 'donation' | 'pledge_payment' | 'expense'
type Period = 'daily' | 'weekly' | 'monthly' | 'yearly'
type QuickRange = 'today' | 'week' | 'month' | 'year' | 'all' | ''

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

const TYPE_META: Record<TxType, { label: string; badge: string; text: string }> = {
  tuition:           { label: 'Tuition',          badge: 'bg-blue-100 text-blue-700',       text: 'text-blue-600' },
  registration_fee:  { label: 'Registration Fee',  badge: 'bg-rose-100 text-rose-700',       text: 'text-rose-600' },
  building_fund:     { label: 'Building Fund',     badge: 'bg-amber-100 text-amber-700',     text: 'text-amber-600' },
  phone_charge:      { label: 'Phone Charge',      badge: 'bg-sky-100 text-sky-700',         text: 'text-sky-600' },
  donation:          { label: 'Donation',          badge: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-600' },
  pledge_payment:    { label: 'Pledge Payment',    badge: 'bg-teal-100 text-teal-700',       text: 'text-teal-600' },
  expense:           { label: 'Expense',           badge: 'bg-red-100 text-red-700',         text: 'text-red-600' },
}
const INCOME_TYPES: TxType[] = ['tuition', 'registration_fee', 'building_fund', 'phone_charge', 'donation', 'pledge_payment']

const PERIOD_LABEL: Record<Period, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }

const CATEGORY_LABEL: Record<string, string> = {
  monthly_recurring: 'Monthly Recurring',
  one_time: 'One-Time',
  event: 'Event',
}

// Supabase's default max_rows (1000) silently truncates an unpaginated
// .select() — page through in 1000-row chunks so a busy "All Time" range
// (thousands of tuition payments across years) can't quietly drop rows.
// See lib/sola/* for the prior incident this pattern was built to avoid.
//
// The query callback's `data` is intentionally untyped here: without
// generated Supabase DB types, the client infers embedded many-to-one
// relations (e.g. donations.donors) as arrays even though they resolve to
// single objects at runtime — asserting the real shape via T avoids fighting
// that inference mismatch (the Reports page hits the same quirk).
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

function periodKey(dateStr: string, period: Period): string {
  if (period === 'yearly') return dateStr.slice(0, 4)
  if (period === 'monthly') return dateStr.slice(0, 7)
  if (period === 'daily') return dateStr
  const d = new Date(`${dateStr}T00:00:00`)
  const diffFromMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - diffFromMonday)
  return d.toISOString().slice(0, 10)
}

function periodLabel(key: string, period: Period): string {
  if (period === 'yearly') return key
  if (period === 'monthly') {
    const [y, m] = key.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  if (period === 'daily') return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const start = new Date(`${key}T00:00:00`)
  const end = new Date(start); end.setDate(start.getDate() + 6)
  return `Week of ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

export default function CashFlowPage() {
  const supabase = createClient()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [startDate, setStartDate] = useState(() => new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [activeRange, setActiveRange] = useState<QuickRange>('year')
  const [period, setPeriod] = useState<Period>('monthly')
  const [includeArchived, setIncludeArchived] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
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

      const pledgePaymentRows = await selectAll<{
        id: string; amount: number; payment_date: string
        pledges: { purpose: string | null; donors: { name: string } | null } | null
      }>((from, to) => {
        let q = supabase.from('pledge_payments')
          .select('id, amount, payment_date, pledges(purpose, donors(name))')
          .order('id', { ascending: true })
          .range(from, to)
        if (startDate) q = q.gte('payment_date', startDate)
        if (endDate) q = q.lte('payment_date', endDate)
        return q
      })

      // Fetched as a nested embed on students, not a standalone
      // tuition_payments request — some school network filters block any
      // direct request to that resource outright (confirmed live on the
      // student tuition page), so payments only reliably arrive piggybacked
      // on a request whose primary resource is something else. Embedding
      // under students (not tuition_plans) matters here specifically:
      // registration-fee payments have no tuition_plan_id at all, so they'd
      // silently vanish from this report if plans were the parent instead.
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
            subLabel: type === 'donation' ? 'Donation (family record)' : TYPE_META[type].label,
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
      tx.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      setTransactions(tx)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cash flow data')
    } finally {
      setLoading(false)
    }
  }, [supabase, startDate, endDate, includeArchived])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount/filter-change
  useEffect(() => { fetchAll() }, [fetchAll])

  function applyQuickRange(range: QuickRange) {
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    setActiveRange(range)
    if (range === 'today') { setStartDate(todayStr); setEndDate(todayStr); return }
    if (range === 'week') {
      const diffFromMonday = (now.getDay() + 6) % 7
      const monday = new Date(now); monday.setDate(now.getDate() - diffFromMonday)
      setStartDate(monday.toISOString().slice(0, 10)); setEndDate(todayStr); return
    }
    if (range === 'month') {
      setStartDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)); setEndDate(todayStr); return
    }
    if (range === 'year') {
      setStartDate(new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10)); setEndDate(todayStr); return
    }
    if (range === 'all') { setStartDate(''); setEndDate(''); return }
  }

  const totalsByType = INCOME_TYPES.reduce((acc, t) => {
    acc[t] = transactions.filter(x => x.type === t).reduce((s, x) => s + x.amount, 0)
    return acc
  }, {} as Record<TxType, number>)
  const totalIn = INCOME_TYPES.reduce((s, t) => s + totalsByType[t], 0)
  const totalOut = transactions.filter(x => x.direction === 'out').reduce((s, x) => s + x.amount, 0)
  const net = totalIn - totalOut

  const expenseByCategory = transactions
    .filter(x => x.type === 'expense')
    .reduce((acc, x) => { acc[x.label] = (acc[x.label] ?? 0) + x.amount; return acc }, {} as Record<string, number>)

  const buckets = new Map<string, { in: number; out: number }>()
  for (const t of transactions) {
    const key = periodKey(t.date, period)
    const b = buckets.get(key) ?? { in: 0, out: 0 }
    if (t.direction === 'in') b.in += t.amount; else b.out += t.amount
    buckets.set(key, b)
  }
  const bucketRows = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))

  const QUICK_RANGES: { key: QuickRange; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
    { key: 'all', label: 'All Time' },
  ]

  const exportData = transactions.map(t => ({
    date: t.date,
    type: TYPE_META[t.type].label,
    name: t.label,
    details: t.subLabel,
    amount: t.direction === 'out' ? -t.amount : t.amount,
  }))

  if (loading) return <div className="text-center py-12 text-slate-500">Loading cash flow...</div>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Cash Flow</h1>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* Range + breakdown controls */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {QUICK_RANGES.map(r => (
            <button key={r.key} onClick={() => applyQuickRange(r.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                activeRange === r.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Start Date</label>
            <input type="date" value={startDate}
              onChange={e => { setStartDate(e.target.value); setActiveRange('') }}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">End Date</label>
            <input type="date" value={endDate}
              onChange={e => { setEndDate(e.target.value); setActiveRange('') }}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Breakdown</label>
            <select value={period} onChange={e => setPeriod(e.target.value as Period)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer pb-2">
            <input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)}
              className="w-3.5 h-3.5 text-blue-600 rounded" />
            Include archived
          </label>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 text-green-600 mb-1"><TrendingUp size={16} /><span className="text-xs font-medium">Total In</span></div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(totalIn)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{transactions.filter(t => t.direction === 'in').length} transactions</div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 text-red-500 mb-1"><TrendingDown size={16} /><span className="text-xs font-medium">Total Out</span></div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(totalOut)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{transactions.filter(t => t.direction === 'out').length} transactions</div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-1"><DollarSign size={16} className={net >= 0 ? 'text-green-600' : 'text-red-500'} /><span className="text-xs font-medium text-slate-500">Net</span></div>
          <div className={`text-2xl font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(net)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{net >= 0 ? 'surplus' : 'deficit'}</div>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <p className="text-xs font-medium text-slate-500 mb-3">Income by Category</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {INCOME_TYPES.map(t => (
              <div key={t} className="rounded-lg border border-slate-100 p-3">
                <div className={`text-xs font-medium ${TYPE_META[t].text}`}>{TYPE_META[t].label}</div>
                <div className="text-base font-bold text-slate-900">{formatCurrency(totalsByType[t])}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <p className="text-xs font-medium text-slate-500 mb-3">Expenses by Category</p>
          {Object.keys(expenseByCategory).length === 0 ? (
            <p className="text-sm text-slate-400">No expenses in this period.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                <div key={cat} className="rounded-lg border border-slate-100 p-3">
                  <div className="text-xs font-medium text-red-600">{cat}</div>
                  <div className="text-base font-bold text-slate-900">{formatCurrency(amt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Period breakdown */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <p className="font-semibold text-slate-900">{PERIOD_LABEL[period]} Breakdown</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Period</th>
                <th className="text-right px-5 py-3 text-slate-500 font-medium">In</th>
                <th className="text-right px-5 py-3 text-slate-500 font-medium">Out</th>
                <th className="text-right px-5 py-3 text-slate-500 font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {bucketRows.map(([key, b]) => (
                <tr key={key} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-5 py-3 text-slate-900 font-medium">{periodLabel(key, period)}</td>
                  <td className="px-5 py-3 text-right text-green-600">{formatCurrency(b.in)}</td>
                  <td className="px-5 py-3 text-right text-red-600">{formatCurrency(b.out)}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${b.in - b.out >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(b.in - b.out)}</td>
                </tr>
              ))}
              {bucketRows.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No transactions for the selected period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full ledger */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="font-semibold text-slate-900">All Transactions</p>
          <ExportButton
            data={exportData}
            columns={[
              { header: 'Date', key: 'date' }, { header: 'Type', key: 'type' },
              { header: 'Name', key: 'name' }, { header: 'Details', key: 'details' },
              { header: 'Amount', key: 'amount', format: (v: number) => `$${Number(v).toFixed(2)}` },
            ]}
            filename="cash-flow"
            title="Cash Flow"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Date</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Type</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Description</th>
                <th className="text-right px-5 py-3 text-slate-500 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{new Date(`${t.date}T00:00:00`).toLocaleDateString()}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_META[t.type].badge}`}>{TYPE_META[t.type].label}</span>
                  </td>
                  <td className="px-5 py-3">
                    {t.href ? (
                      <Link href={t.href} className="font-medium text-slate-900 hover:text-blue-600">{t.label}</Link>
                    ) : (
                      <span className="font-medium text-slate-900">{t.label}</span>
                    )}
                    {t.subLabel && <span className="text-slate-400"> — {t.subLabel}</span>}
                  </td>
                  <td className={`px-5 py-3 text-right font-semibold ${t.direction === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                    {t.direction === 'out' ? '−' : ''}{formatCurrency(t.amount)}
                  </td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No transactions for the selected period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
