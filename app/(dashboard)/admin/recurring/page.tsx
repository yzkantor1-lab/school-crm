'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'

type Donor = { id: string; name: string }
type RecurringDonation = {
  id: string; donor_id: string; amount: number; frequency: string; start_date: string
  end_date: string | null; total_months: number | null; months_completed: number
  day_of_month: number; donation_method: string; active: boolean; notes: string | null
  donors: { name: string }
}

export default function RecurringDonationsPage() {
  const supabase = createClient()
  const [recurring, setRecurring] = useState<RecurringDonation[]>([])
  const [donors, setDonors] = useState<Donor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<RecurringDonation | null>(null)
  const [formData, setFormData] = useState({
    donor_id: '', amount: '', frequency: 'monthly', start_date: new Date().toISOString().split('T')[0],
    end_date: '', total_months: '', day_of_month: '1', donation_method: 'Credit card', notes: ''
  })

  const load = useCallback(async () => {
    const { data } = await supabase.from('recurring_donations').select('*, donors(name)').order('start_date', { ascending: false })
    setRecurring(data || [])
    setLoading(false)
  }, [supabase])

  const loadDonors = useCallback(async () => {
    const { data } = await supabase.from('donors').select('id, name').order('name')
    setDonors(data || [])
  }, [supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await
  useEffect(() => { load(); loadDonors() }, [load, loadDonors])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      donor_id: formData.donor_id, amount: parseFloat(formData.amount), frequency: formData.frequency,
      start_date: formData.start_date, end_date: formData.end_date || null,
      total_months: formData.total_months ? parseInt(formData.total_months) : null,
      day_of_month: parseInt(formData.day_of_month), donation_method: formData.donation_method,
      notes: formData.notes || null, updated_at: new Date().toISOString(),
    }
    if (editing) {
      const { error } = await supabase.from('recurring_donations').update(payload).eq('id', editing.id)
      if (error) { alert('Failed to update'); return }
    } else {
      const { error } = await supabase.from('recurring_donations').insert(payload)
      if (error) { alert('Failed to create'); return }
    }
    reset(); load()
  }

  async function toggleActive(d: RecurringDonation) {
    await supabase.from('recurring_donations').update({ active: !d.active, updated_at: new Date().toISOString() }).eq('id', d.id)
    load()
  }

  async function deleteDonation(id: string) {
    if (!confirm('Delete this recurring donation?')) return
    await supabase.from('recurring_donations').delete().eq('id', id)
    load()
  }

  function edit(d: RecurringDonation) {
    setEditing(d)
    setFormData({
      donor_id: d.donor_id, amount: d.amount.toString(), frequency: d.frequency, start_date: d.start_date,
      end_date: d.end_date || '', total_months: d.total_months?.toString() || '', day_of_month: d.day_of_month.toString(),
      donation_method: d.donation_method, notes: d.notes || ''
    })
    setShowForm(true)
  }

  function reset() {
    setFormData({ donor_id: '', amount: '', frequency: 'monthly', start_date: new Date().toISOString().split('T')[0], end_date: '', total_months: '', day_of_month: '1', donation_method: 'Credit card', notes: '' })
    setEditing(null); setShowForm(false)
  }

  const active = recurring.filter(d => d.active)
  const monthlyTotal = active.filter(d => d.frequency === 'monthly').reduce((s, d) => s + d.amount, 0)

  if (loading) return <div className="text-center py-12 text-slate-500">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Recurring Donations</h1>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium">
          <Plus size={16} />New Recurring
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <div className="text-sm text-slate-500 mb-1">Active Recurring</div>
          <div className="text-2xl font-bold text-slate-900">{active.length}</div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <div className="text-sm text-slate-500 mb-1">Monthly Recurring</div>
          <div className="text-2xl font-bold text-green-600">{formatCurrency(monthlyTotal)}</div>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-slate-900 mb-4">{editing ? 'Edit' : 'New'} Recurring Donation</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Donor</label>
                <select required value={formData.donor_id} onChange={e => setFormData({ ...formData, donor_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                  <option value="">Select a donor</option>
                  {donors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                  <input type="number" step="0.01" required value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Frequency</label>
                  <select value={formData.frequency} onChange={e => setFormData({ ...formData, frequency: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Day of Month</label>
                  <input type="number" min="1" max="31" required value={formData.day_of_month} onChange={e => setFormData({ ...formData, day_of_month: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                  <input type="date" required value={formData.start_date} onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Total Months</label>
                  <input type="number" min="1" value={formData.total_months} onChange={e => setFormData({ ...formData, total_months: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Leave blank = indefinite" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                  <input type="date" value={formData.end_date} onChange={e => setFormData({ ...formData, end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
                <select value={formData.donation_method} onChange={e => setFormData({ ...formData, donation_method: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  {['Credit card','Check','Cash','Zelle','Bank Transfer','Other'].map(m => <option key={m} value={m}>{m}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium">
                  {editing ? 'Update' : 'Create'}
                </button>
                <button type="button" onClick={reset} className="flex-1 bg-slate-200 text-slate-700 py-2 rounded-lg hover:bg-slate-300 transition text-sm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Donor</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Amount</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Frequency</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium hidden md:table-cell">Day</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium hidden md:table-cell">Progress</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Status</th>
                <th className="text-right px-5 py-3 text-slate-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recurring.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">No recurring donations yet.</td></tr>
              ) : recurring.map(d => (
                <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-5 py-3 font-medium text-slate-900">{d.donors.name}</td>
                  <td className="px-5 py-3 text-slate-900">{formatCurrency(d.amount)}</td>
                  <td className="px-5 py-3 text-slate-600 capitalize">{d.frequency}</td>
                  <td className="px-5 py-3 text-slate-600 hidden md:table-cell">{d.day_of_month}</td>
                  <td className="px-5 py-3 text-slate-600 hidden md:table-cell">
                    {d.total_months ? `${d.months_completed}/${d.total_months} mo` : `${d.months_completed} mo`}
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => toggleActive(d)}
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium transition ${d.active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                      {d.active ? <><ToggleRight size={13} />Active</> : <><ToggleLeft size={13} />Inactive</>}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => edit(d)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={14} /></button>
                      <button onClick={() => deleteDonation(d.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
