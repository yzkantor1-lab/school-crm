'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import { Plus, Edit2, Trash2, Search, Download, Archive, ArchiveRestore, Receipt } from 'lucide-react'
import ExportButton from '@/components/ExportButton'

type Expense = {
  id: string; date: string; category: string; description: string; amount: number
  vendor: string | null; payment_method: string; receipt_url: string | null
  notes: string | null; archived: boolean
}

const CATEGORIES = [
  'Salaries & Wages','Utilities','Rent & Facilities','Supplies & Materials','Maintenance & Repairs',
  'Food & Catering','Transportation','Technology & Equipment','Insurance','Professional Services',
  'Marketing & Outreach','Events & Programs','Books & Educational Materials','Other'
]
const METHODS = ['Cash','Check','Credit Card','Debit Card','Bank Transfer','Online Payment','Other']

export default function ExpensesPage() {
  const supabase = createClient()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showBulkArchive, setShowBulkArchive] = useState(false)
  const [selectedYear, setSelectedYear] = useState('')
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0], category: '', description: '',
    amount: '', vendor: '', payment_method: 'Cash', receipt_url: '', notes: ''
  })

  useEffect(() => { fetchExpenses() }, [])

  async function fetchExpenses() {
    setLoading(true)
    const { data } = await supabase.from('expenses').select('*').order('date', { ascending: false })
    setExpenses(data || [])
    setLoading(false)
  }

  const filtered = expenses.filter(e => {
    if (e.archived !== showArchived) return false
    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      if (!e.description.toLowerCase().includes(s) && !e.vendor?.toLowerCase().includes(s) && !e.notes?.toLowerCase().includes(s)) return false
    }
    if (categoryFilter && e.category !== categoryFilter) return false
    if (dateFrom && e.date < dateFrom) return false
    if (dateTo && e.date > dateTo) return false
    return true
  })

  const totalFiltered = filtered.reduce((s, e) => s + e.amount, 0)

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      date: formData.date, category: formData.category, description: formData.description,
      amount: parseFloat(formData.amount), vendor: formData.vendor || null,
      payment_method: formData.payment_method, receipt_url: formData.receipt_url || null,
      notes: formData.notes || null, created_by: user?.id || null,
    }
    if (editing) {
      const { error } = await supabase.from('expenses').update(payload).eq('id', editing.id)
      if (error) { alert('Failed to update'); return }
    } else {
      const { error } = await supabase.from('expenses').insert([payload])
      if (error) { alert('Failed to add expense'); return }
    }
    resetForm(); fetchExpenses()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this expense?')) return
    await supabase.from('expenses').delete().eq('id', id)
    fetchExpenses()
  }

  async function handleArchive(id: string, archived: boolean) {
    if (!confirm(`${archived ? 'Archive' : 'Unarchive'} this expense?`)) return
    await supabase.from('expenses').update({ archived }).eq('id', id)
    fetchExpenses()
  }

  async function handleBulkArchive() {
    if (!selectedYear) { alert('Select a year'); return }
    const toArchive = expenses.filter(e => new Date(e.date).getFullYear().toString() === selectedYear && !e.archived)
    if (!toArchive.length) { alert(`No active expenses for ${selectedYear}`); return }
    if (!confirm(`Archive ${toArchive.length} expenses from ${selectedYear}?`)) return
    await supabase.from('expenses').update({ archived: true }).in('id', toArchive.map(e => e.id))
    setShowBulkArchive(false); setSelectedYear(''); fetchExpenses()
  }

  function editExpense(e: Expense) {
    setEditing(e)
    setFormData({ date: e.date, category: e.category, description: e.description, amount: e.amount.toString(), vendor: e.vendor || '', payment_method: e.payment_method, receipt_url: e.receipt_url || '', notes: e.notes || '' })
    setShowForm(true)
  }

  function resetForm() {
    setFormData({ date: new Date().toISOString().split('T')[0], category: '', description: '', amount: '', vendor: '', payment_method: 'Cash', receipt_url: '', notes: '' })
    setEditing(null); setShowForm(false)
  }

  function exportCSV() {
    const headers = ['Date','Category','Description','Amount','Vendor','Payment Method','Notes']
    const rows = filtered.map(e => [e.date, e.category, e.description, formatCurrency(e.amount).replace('$',''), e.vendor||'', e.payment_method, e.notes||''])
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `expenses_${new Date().toISOString().split('T')[0]}.csv`; a.click()
  }

  const years = [...new Set(expenses.map(e => new Date(e.date).getFullYear().toString()))].sort((a,b) => b.localeCompare(a))

  if (loading) return <div className="text-center py-12 text-slate-500">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Expenses</h1>
          <p className="text-sm text-slate-500 mt-0.5">Track and manage institutional expenses</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBulkArchive(!showBulkArchive)}
            className="flex items-center gap-2 bg-slate-600 text-white px-3 py-2 rounded-lg hover:bg-slate-700 transition text-sm">
            <Archive size={15} />Bulk Archive
          </button>
          <button onClick={() => { resetForm(); setShowForm(!showForm) }}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium">
            <Plus size={15} />Add Expense
          </button>
        </div>
      </div>

      {showBulkArchive && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-900 mb-3">Bulk Archive by Year</h3>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-40">
              <label className="block text-xs font-medium text-slate-600 mb-1">Year</label>
              <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="">Choose year...</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button onClick={handleBulkArchive} className="bg-slate-600 text-white px-4 py-2 rounded-lg hover:bg-slate-700 transition text-sm flex items-center gap-2">
              <Archive size={14} />Archive Year
            </button>
            <button onClick={() => { setShowBulkArchive(false); setSelectedYear('') }} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-300 transition text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 space-y-3">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500" />
            Show Archived
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search expenses..." className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-blue-600 font-medium">Total (filtered)</p>
          <p className="text-2xl font-bold text-blue-900">{formatCurrency(totalFiltered)}</p>
          <p className="text-xs text-blue-600 mt-0.5">{filtered.length} transactions</p>
        </div>
        <ExportButton
          data={filtered}
          columns={[
            { header: 'Date', key: 'date' }, { header: 'Category', key: 'category' },
            { header: 'Description', key: 'description' },
            { header: 'Amount', key: 'amount', format: (v: number) => `$${Number(v).toFixed(2)}` },
            { header: 'Vendor', key: 'vendor' }, { header: 'Method', key: 'payment_method' }, { header: 'Notes', key: 'notes' },
          ]}
          filename="expenses"
          title="Expenses"
        />
      </div>

      {showForm && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-900 mb-4">{editing ? 'Edit Expense' : 'Add Expense'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
                <input type="date" required value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1">Category *</label>
                <select required value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  <option value="">Select category</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1">Amount *</label>
                <input type="number" step="0.01" required value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="0.00" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1">Payment Method *</label>
                <select required value={formData.payment_method} onChange={e => setFormData({ ...formData, payment_method: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select></div>
              <div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1">Description *</label>
                <input type="text" required value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Brief description" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1">Vendor</label>
                <input type="text" value={formData.vendor} onChange={e => setFormData({ ...formData, vendor: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Vendor name" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1">Receipt URL</label>
                <input type="url" value={formData.receipt_url} onChange={e => setFormData({ ...formData, receipt_url: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="https://..." /></div>
              <div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium">
                {editing ? 'Update' : 'Add'} Expense
              </button>
              <button type="button" onClick={resetForm} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-300 transition text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-5 py-3 text-slate-500 font-medium">Date</th>
              <th className="text-left px-5 py-3 text-slate-500 font-medium">Category</th>
              <th className="text-left px-5 py-3 text-slate-500 font-medium">Description</th>
              <th className="text-left px-5 py-3 text-slate-500 font-medium hidden md:table-cell">Vendor</th>
              <th className="text-right px-5 py-3 text-slate-500 font-medium">Amount</th>
              <th className="text-left px-5 py-3 text-slate-500 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                {showArchived ? 'No archived expenses.' : 'No expenses yet.'}
              </td></tr>
            ) : filtered.map(expense => (
              <tr key={expense.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                <td className="px-5 py-3 text-slate-600">{new Date(expense.date).toLocaleDateString()}</td>
                <td className="px-5 py-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">{expense.category}</span>
                </td>
                <td className="px-5 py-3 text-slate-900">
                  {expense.description}
                  {expense.notes && <p className="text-xs text-slate-400 mt-0.5">{expense.notes}</p>}
                </td>
                <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{expense.vendor || '—'}</td>
                <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCurrency(expense.amount)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1.5">
                    {expense.receipt_url && (
                      <a href={expense.receipt_url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"><Receipt size={14} /></a>
                    )}
                    {!expense.archived ? (
                      <>
                        <button onClick={() => editExpense(expense)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={14} /></button>
                        <button onClick={() => handleArchive(expense.id, true)} className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"><Archive size={14} /></button>
                        <button onClick={() => handleDelete(expense.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                      </>
                    ) : (
                      <button onClick={() => handleArchive(expense.id, false)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><ArchiveRestore size={14} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
