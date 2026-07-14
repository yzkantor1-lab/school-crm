'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import { TrendingUp, TrendingDown, DollarSign, Filter } from 'lucide-react'
import ExportButton from '@/components/ExportButton'

type Donation = {
  id: string; amount: number; donation_method: string; donation_date: string
  purpose: string; notes: string | null; archived: boolean
  donors: { name: string; category: string | null; relationship: string | null; email: string | null; phone_number: string | null }
}
type Expense = {
  id: string; date: string; category: string; description: string; amount: number
  vendor: string | null; payment_method: string; notes: string | null
}
type Donor = { id: string; name: string }

type ReportType = 'summary' | 'donations' | 'expenses'

export default function ReportsPage() {
  const supabase = createClient()
  const [donations, setDonations] = useState<Donation[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [donors, setDonors] = useState<Donor[]>([])
  const [purposes, setPurposes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [reportType, setReportType] = useState<ReportType>('summary')
  const [filters, setFilters] = useState({
    startDate: '', endDate: '', donorId: '', minAmount: '', maxAmount: '', category: '', showArchived: false
  })

  useEffect(() => { fetchAll() }, [filters.startDate, filters.endDate, filters.donorId])

  async function fetchAll() {
    setLoading(true)
    let dq = supabase.from('donations').select('*, donors(name, category, relationship, email, phone_number)').order('donation_date', { ascending: false })
    if (filters.startDate) dq = dq.gte('donation_date', filters.startDate)
    if (filters.endDate) dq = dq.lte('donation_date', filters.endDate)
    if (filters.donorId) dq = dq.eq('donor_id', filters.donorId)

    let eq = supabase.from('expenses').select('*').order('date', { ascending: false })
    if (filters.startDate) eq = eq.gte('date', filters.startDate)
    if (filters.endDate) eq = eq.lte('date', filters.endDate)

    const [{ data: dn }, { data: ex }, { data: dr }, { data: st }] = await Promise.all([
      dq, eq,
      supabase.from('donors').select('id, name').order('name'),
      supabase.from('donor_settings').select('donation_purposes').limit(1).maybeSingle()
    ])

    setDonations(dn || [])
    setExpenses(ex || [])
    setDonors(dr || [])
    setPurposes(st?.donation_purposes || ['General Fund'])
    setLoading(false)
  }

  const filteredDonations = donations.filter(d => {
    if (!filters.showArchived && d.archived) return false
    if (filters.minAmount && d.amount < Number(filters.minAmount)) return false
    if (filters.maxAmount && d.amount > Number(filters.maxAmount)) return false
    if (filters.category && d.purpose !== filters.category) return false
    return true
  })

  const filteredExpenses = expenses.filter(e => {
    if (filters.minAmount && e.amount < Number(filters.minAmount)) return false
    if (filters.maxAmount && e.amount > Number(filters.maxAmount)) return false
    if (filters.category && e.category !== filters.category) return false
    return true
  })

  const totalDonations = filteredDonations.reduce((s, d) => s + Number(d.amount), 0)
  const totalExpenses = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0)
  const net = totalDonations - totalExpenses

  function exportCSV() {
    let content = ''
    if (reportType === 'donations') {
      const h = ['Date','Donor','Purpose','Amount','Method','Category','Relationship','Email','Phone','Notes']
      const rows = filteredDonations.map(d => [d.donation_date, d.donors.name, d.purpose, d.amount, d.donation_method, d.donors.category||'', d.donors.relationship||'', d.donors.email||'', d.donors.phone_number||'', d.notes||''])
      content = [h, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    } else if (reportType === 'expenses') {
      const h = ['Date','Category','Description','Amount','Vendor','Method','Notes']
      const rows = filteredExpenses.map(e => [e.date, e.category, e.description, e.amount, e.vendor||'', e.payment_method, e.notes||''])
      content = [h, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    } else {
      const h = ['Type','Date','Description','Amount']
      const rows = [
        ...filteredDonations.map(d => ['Donation', d.donation_date, `${d.donors.name} - ${d.purpose}`, d.amount]),
        ...filteredExpenses.map(e => ['Expense', e.date, `${e.category} - ${e.description}`, e.amount]),
      ].sort((a, b) => new Date(b[1] as string).getTime() - new Date(a[1] as string).getTime())
      content = [h, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    }
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `${reportType}-report-${new Date().toISOString().split('T')[0]}.csv`; a.click()
  }

  function setFilter(key: keyof typeof filters, value: string | boolean) {
    setFilters(f => ({ ...f, [key]: value }))
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Loading reports...</div>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Reports</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 text-green-600 mb-1"><TrendingUp size={16} /><span className="text-xs font-medium">Total Donations</span></div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(totalDonations)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{filteredDonations.length} records</div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 text-red-500 mb-1"><TrendingDown size={16} /><span className="text-xs font-medium">Total Expenses</span></div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(totalExpenses)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{filteredExpenses.length} records</div>
        </div>
        <div className={`bg-white p-5 rounded-xl shadow-sm border border-slate-100`}>
          <div className="flex items-center gap-2 mb-1"><DollarSign size={16} className={net >= 0 ? 'text-green-600' : 'text-red-500'} /><span className="text-xs font-medium text-slate-500">Net</span></div>
          <div className={`text-2xl font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(net)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{net >= 0 ? 'surplus' : 'deficit'}</div>
        </div>
      </div>

      {/* Report Type Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex border-b border-slate-100">
          {(['summary','donations','expenses'] as ReportType[]).map(t => (
            <button key={t} onClick={() => setReportType(t)}
              className={`flex-1 px-4 py-3 text-sm font-medium capitalize transition ${reportType === t ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="p-4 bg-slate-50 border-b border-slate-100">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className="block text-xs font-medium text-slate-500 mb-1">Start Date</label>
              <input type="date" value={filters.startDate} onChange={e => setFilter('startDate', e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm" /></div>
            <div><label className="block text-xs font-medium text-slate-500 mb-1">End Date</label>
              <input type="date" value={filters.endDate} onChange={e => setFilter('endDate', e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm" /></div>
            {reportType !== 'expenses' && (
              <div><label className="block text-xs font-medium text-slate-500 mb-1">Donor</label>
                <select value={filters.donorId} onChange={e => setFilter('donorId', e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm">
                  <option value="">All Donors</option>
                  {donors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select></div>
            )}
            <div><label className="block text-xs font-medium text-slate-500 mb-1">Min Amount</label>
              <input type="number" value={filters.minAmount} onChange={e => setFilter('minAmount', e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm" placeholder="0" /></div>
          </div>
          {reportType === 'donations' && (
            <div className="mt-3 flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
                <input type="checkbox" checked={filters.showArchived} onChange={e => setFilter('showArchived', e.target.checked)}
                  className="w-3.5 h-3.5 text-blue-600 rounded" />
                Include archived
              </label>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {reportType === 'summary' && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Type</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Date</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Description</th>
                  <th className="text-right px-5 py-3 text-slate-500 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...filteredDonations.map(d => ({ type: 'Donation', date: d.donation_date, desc: `${d.donors.name} — ${d.purpose}`, amount: d.amount, id: d.id })),
                  ...filteredExpenses.map(e => ({ type: 'Expense', date: e.date, desc: `${e.category} — ${e.description}`, amount: -e.amount, id: e.id })),
                ].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 100).map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${row.type === 'Donation' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{row.type}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{new Date(row.date).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-slate-900">{row.desc}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${row.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(Math.abs(row.amount))}</td>
                  </tr>
                ))}
                {!filteredDonations.length && !filteredExpenses.length && (
                  <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No data for the selected period.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {reportType === 'donations' && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Date</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Donor</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Purpose</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium hidden md:table-cell">Method</th>
                  <th className="text-right px-5 py-3 text-slate-500 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredDonations.map(d => (
                  <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-5 py-3 text-slate-600">{new Date(d.donation_date).toLocaleDateString()}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">{d.donors.name}</td>
                    <td className="px-5 py-3 text-slate-600">{d.purpose}</td>
                    <td className="px-5 py-3 text-slate-600 hidden md:table-cell">{d.donation_method}</td>
                    <td className="px-5 py-3 text-right font-semibold text-green-600">{formatCurrency(Number(d.amount))}</td>
                  </tr>
                ))}
                {!filteredDonations.length && (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No donations for the selected period.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {reportType === 'expenses' && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Date</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Category</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Description</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium hidden md:table-cell">Vendor</th>
                  <th className="text-right px-5 py-3 text-slate-500 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map(e => (
                  <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-5 py-3 text-slate-600">{new Date(e.date).toLocaleDateString()}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">{e.category}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-900">{e.description}</td>
                    <td className="px-5 py-3 text-slate-600 hidden md:table-cell">{e.vendor || '—'}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCurrency(Number(e.amount))}</td>
                  </tr>
                ))}
                {!filteredExpenses.length && (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No expenses for the selected period.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
          {reportType === 'donations' && (
            <ExportButton
              data={filteredDonations.map(d => ({ ...d, donor_name: d.donors.name, donor_email: d.donors.email, donor_phone: d.donors.phone_number, donor_category: d.donors.category, donor_relationship: d.donors.relationship }))}
              columns={[
                { header: 'Date', key: 'donation_date' }, { header: 'Donor', key: 'donor_name' },
                { header: 'Purpose', key: 'purpose' }, { header: 'Amount', key: 'amount', format: (v: number) => `$${Number(v).toFixed(2)}` },
                { header: 'Method', key: 'donation_method' }, { header: 'Category', key: 'donor_category' },
                { header: 'Email', key: 'donor_email' }, { header: 'Phone', key: 'donor_phone' }, { header: 'Notes', key: 'notes' },
              ]}
              filename="donations-report"
              title="Donations Report"
            />
          )}
          {reportType === 'expenses' && (
            <ExportButton
              data={filteredExpenses}
              columns={[
                { header: 'Date', key: 'date' }, { header: 'Category', key: 'category' },
                { header: 'Description', key: 'description' }, { header: 'Amount', key: 'amount', format: (v: number) => `$${Number(v).toFixed(2)}` },
                { header: 'Vendor', key: 'vendor' }, { header: 'Method', key: 'payment_method' }, { header: 'Notes', key: 'notes' },
              ]}
              filename="expenses-report"
              title="Expenses Report"
            />
          )}
          {reportType === 'summary' && (
            <ExportButton
              data={[
                ...filteredDonations.map(d => ({ type: 'Donation', date: d.donation_date, description: `${d.donors.name} — ${d.purpose}`, amount: d.amount })),
                ...filteredExpenses.map(e => ({ type: 'Expense', date: e.date, description: `${e.category} — ${e.description}`, amount: e.amount })),
              ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())}
              columns={[
                { header: 'Type', key: 'type' }, { header: 'Date', key: 'date' },
                { header: 'Description', key: 'description' }, { header: 'Amount', key: 'amount', format: (v: number) => `$${Number(v).toFixed(2)}` },
              ]}
              filename="summary-report"
              title="Summary Report"
            />
          )}
        </div>
      </div>
    </div>
  )
}
