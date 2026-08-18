'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import {
  CheckCircle, XCircle, Plus, Edit2, Trash2, Search, UserPlus,
  DollarSign, ArrowUpDown, ArrowUp, ArrowDown, Filter, X
} from 'lucide-react'
import EmailInput from '@/components/EmailInput'

type Donor = { id: string; name: string }
type Pledge = {
  id: string; donor_id: string; amount: number; amount_paid: number
  pledge_date: string; due_date: string | null; purpose: string | null
  fulfilled: boolean; fulfilled_date: string | null; notes: string | null
  donors: { name: string }
}
type PledgePayment = {
  id: string; pledge_id: string; amount: number; payment_date: string; payment_method: string; notes: string | null
}

type SortField = 'donor' | 'amount' | 'due_date' | 'status'
type StatusFilter = 'all' | 'fulfilled' | 'outstanding'

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: 'asc' | 'desc' }) {
  return sortField === field ? (sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={13} className="opacity-40" />
}

export default function PledgesPage() {
  const supabase = createClient()
  const donorSearchRef = useRef<HTMLDivElement>(null)

  const [pledges, setPledges] = useState<Pledge[]>([])
  const [donors, setDonors] = useState<Donor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingPledge, setEditingPledge] = useState<Pledge | null>(null)
  const [viewingPledge, setViewingPledge] = useState<Pledge | null>(null)
  const [pledgePayments, setPledgePayments] = useState<PledgePayment[]>([])
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [sortField, setSortField] = useState<SortField>('due_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [donorSearch, setDonorSearch] = useState('')
  const [showDonorDropdown, setShowDonorDropdown] = useState(false)
  const [showNewDonorForm, setShowNewDonorForm] = useState(false)
  const [newDonorData, setNewDonorData] = useState({ name: '', email: '', phone_number: '', address: '' })
  const [formData, setFormData] = useState({
    donor_id: '', amount: '', pledge_date: new Date().toISOString().split('T')[0], due_date: '', purpose: '', notes: ''
  })
  const [paymentForm, setPaymentForm] = useState({
    amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'Cash', notes: ''
  })

  const loadPledges = useCallback(async () => {
    const { data } = await supabase.from('pledges').select('*, donors(name)').order('due_date', { ascending: true })
    setPledges(data || [])
    setLoading(false)
  }, [supabase])

  const loadDonors = useCallback(async () => {
    const { data } = await supabase.from('donors').select('id, name').order('name')
    setDonors(data || [])
  }, [supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await
  useEffect(() => { loadPledges(); loadDonors() }, [loadPledges, loadDonors])
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (donorSearchRef.current && !donorSearchRef.current.contains(e.target as Node)) setShowDonorDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function loadPayments(pledgeId: string) {
    const { data } = await supabase.from('pledge_payments').select('*').eq('pledge_id', pledgeId).order('payment_date', { ascending: false })
    setPledgePayments(data || [])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      donor_id: formData.donor_id, amount: parseFloat(formData.amount),
      pledge_date: formData.pledge_date, due_date: formData.due_date || null,
      purpose: formData.purpose || null, notes: formData.notes || null,
    }
    if (editingPledge) {
      const { error } = await supabase.from('pledges').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingPledge.id)
      if (error) { alert('Failed to update pledge'); return }
    } else {
      const { error } = await supabase.from('pledges').insert(payload)
      if (error) { alert('Failed to create pledge'); return }
    }
    resetForm(); loadPledges()
  }

  async function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!viewingPledge) return
    const { error } = await supabase.from('pledge_payments').insert({
      pledge_id: viewingPledge.id, amount: parseFloat(paymentForm.amount),
      payment_date: paymentForm.payment_date, payment_method: paymentForm.payment_method, notes: paymentForm.notes || null,
    })
    if (error) { alert('Failed to record payment'); return }
    setPaymentForm({ amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'Cash', notes: '' })
    setShowPaymentForm(false)
    await loadPayments(viewingPledge.id)
    await loadPledges()
    const updated = (await supabase.from('pledges').select('*, donors(name)').eq('id', viewingPledge.id).single()).data
    if (updated) setViewingPledge(updated)
  }

  async function deletePayment(id: string) {
    if (!confirm('Delete this payment?')) return
    await supabase.from('pledge_payments').delete().eq('id', id)
    if (viewingPledge) { await loadPayments(viewingPledge.id); await loadPledges() }
  }

  async function deletePledge(id: string) {
    if (!confirm('Delete this pledge?')) return
    await supabase.from('pledges').delete().eq('id', id)
    loadPledges()
  }

  async function handleCreateNewDonor() {
    if (!newDonorData.name.trim()) { alert('Enter a donor name'); return }
    const { data, error } = await supabase.from('donors').insert({
      name: newDonorData.name.trim(), email: newDonorData.email || null, phone_number: newDonorData.phone_number || null,
      address: newDonorData.address || null, category: 'Individual',
    }).select().single()
    if (error) { alert('Failed to create donor'); return }
    if (data) {
      await loadDonors()
      setFormData({ ...formData, donor_id: data.id })
      setDonorSearch(data.name)
      setShowNewDonorForm(false)
      setNewDonorData({ name: '', email: '', phone_number: '', address: '' })
      setShowDonorDropdown(false)
    }
  }

  function resetForm() {
    setFormData({ donor_id: '', amount: '', pledge_date: new Date().toISOString().split('T')[0], due_date: '', purpose: '', notes: '' })
    setDonorSearch(''); setEditingPledge(null); setShowForm(false); setShowNewDonorForm(false)
  }

  function editPledge(pledge: Pledge) {
    setEditingPledge(pledge)
    setFormData({ donor_id: pledge.donor_id, amount: pledge.amount.toString(), pledge_date: pledge.pledge_date, due_date: pledge.due_date || '', purpose: pledge.purpose || '', notes: pledge.notes || '' })
    setDonorSearch(pledge.donors.name)
    setShowForm(true)
  }

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const filteredDonors = donors.filter(d => d.name.toLowerCase().includes(donorSearch.toLowerCase()))
  const selectedDonorObj = donors.find(d => d.id === formData.donor_id)

  const filteredSorted = pledges
    .filter(p => {
      if (statusFilter === 'fulfilled' && !p.fulfilled) return false
      if (statusFilter === 'outstanding' && p.fulfilled) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return p.donors.name.toLowerCase().includes(q) || p.purpose?.toLowerCase().includes(q) || formatCurrency(p.amount).includes(q)
      }
      return true
    })
    .sort((a, b) => {
      let cmp = 0
      if (sortField === 'donor') cmp = a.donors.name.localeCompare(b.donors.name)
      else if (sortField === 'amount') cmp = a.amount - b.amount
      else if (sortField === 'due_date') cmp = (a.due_date ? new Date(a.due_date).getTime() : 0) - (b.due_date ? new Date(b.due_date).getTime() : 0)
      else if (sortField === 'status') cmp = (a.fulfilled ? 1 : 0) - (b.fulfilled ? 1 : 0)
      return sortDir === 'asc' ? cmp : -cmp
    })

  const totalPledged = pledges.reduce((s, p) => s + p.amount, 0)
  const totalPaid = pledges.reduce((s, p) => s + (p.amount_paid || 0), 0)

  if (loading) return <div className="text-center py-12 text-slate-500">Loading pledges...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Pledges</h1>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium">
          <Plus size={16} />New Pledge
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Pledged', value: formatCurrency(totalPledged), color: 'text-slate-900' },
          { label: 'Total Paid', value: formatCurrency(totalPaid), color: 'text-green-600' },
          { label: 'Outstanding', value: formatCurrency(totalPledged - totalPaid), color: 'text-orange-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
            <div className="text-sm text-slate-500 mb-1">{label}</div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 space-y-3">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by donor, purpose, or amount..."
              className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={15} /></button>}
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition ${showFilters || statusFilter !== 'all' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
            <Filter size={15} />Filters
            {statusFilter !== 'all' && <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">1</span>}
          </button>
        </div>
        {showFilters && (
          <div className="pt-3 border-t border-slate-100 flex gap-4 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="all">All</option>
                <option value="outstanding">Outstanding</option>
                <option value="fulfilled">Fulfilled</option>
              </select>
            </div>
            {(searchQuery || statusFilter !== 'all') && (
              <div className="flex items-end">
                <button onClick={() => { setSearchQuery(''); setStatusFilter('all') }} className="text-sm text-slate-500 hover:text-slate-700 underline">Clear filters</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pledge Detail Modal */}
      {viewingPledge && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Pledge Details</h2>
                <p className="text-sm text-slate-500 mt-0.5">{viewingPledge.donors.name}</p>
              </div>
              <button onClick={() => setViewingPledge(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { label: 'Pledged Amount', value: formatCurrency(viewingPledge.amount), color: 'text-slate-900' },
                { label: 'Amount Paid', value: formatCurrency(viewingPledge.amount_paid || 0), color: 'text-green-600' },
                { label: 'Remaining', value: formatCurrency(viewingPledge.amount - (viewingPledge.amount_paid || 0)), color: 'text-orange-600' },
                { label: 'Purpose', value: viewingPledge.purpose || 'General', color: 'text-slate-900' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-50 p-3 rounded-lg">
                  <div className="text-xs text-slate-500 mb-1">{label}</div>
                  <div className={`text-lg font-bold ${color}`}>{value}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900">Payments</h3>
                <button onClick={() => setShowPaymentForm(!showPaymentForm)}
                  className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition text-sm">
                  <Plus size={14} />Add Payment
                </button>
              </div>
              {showPaymentForm && (
                <form onSubmit={handlePaymentSubmit} className="bg-slate-50 p-4 rounded-lg mb-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-slate-600 mb-1">Amount</label>
                      <input type="number" step="0.01" required value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                      <input type="date" required value={paymentForm.payment_date} onChange={e => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
                      <select value={paymentForm.payment_method} onChange={e => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                        {['Cash','Check','Credit Card','Bank Transfer','Other'].map(m => <option key={m} value={m}>{m}</option>)}
                      </select></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                      <input type="text" value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Optional" /></div>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition text-sm">Record</button>
                    <button type="button" onClick={() => setShowPaymentForm(false)} className="bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-300 transition text-sm">Cancel</button>
                  </div>
                </form>
              )}
              <div className="space-y-2">
                {pledgePayments.length === 0 ? (
                  <p className="text-center py-6 text-slate-400 text-sm">No payments recorded yet</p>
                ) : pledgePayments.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-semibold text-slate-900">{formatCurrency(p.amount)}</span>
                        <span className="text-slate-500">{new Date(p.payment_date).toLocaleDateString()}</span>
                        <span className="text-slate-500">via {p.payment_method}</span>
                      </div>
                      {p.notes && <p className="text-xs text-slate-500 mt-0.5">{p.notes}</p>}
                    </div>
                    <button onClick={() => deletePayment(p.id)} className="text-red-600 hover:text-red-800 p-1"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pledge Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-slate-900 mb-4">{editingPledge ? 'Edit Pledge' : 'New Pledge'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Donor</label>
                <div ref={donorSearchRef} className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                    <input type="text" value={donorSearch}
                      onChange={e => { setDonorSearch(e.target.value); setShowDonorDropdown(true); setShowNewDonorForm(false) }}
                      onFocus={() => setShowDonorDropdown(true)}
                      placeholder="Search or create donor..."
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required={!formData.donor_id} />
                  </div>
                  {showDonorDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredDonors.map(d => (
                        <button key={d.id} type="button" onClick={() => { setFormData({ ...formData, donor_id: d.id }); setDonorSearch(d.name); setShowDonorDropdown(false) }}
                          className={`w-full text-left px-4 py-2 hover:bg-slate-50 text-sm ${formData.donor_id === d.id ? 'bg-blue-50 text-blue-700' : ''}`}>{d.name}</button>
                      ))}
                      <button type="button" onClick={() => { setShowNewDonorForm(true); setNewDonorData({ ...newDonorData, name: donorSearch }) }}
                        className="w-full text-left px-4 py-2 hover:bg-slate-50 border-t border-slate-100 text-blue-600 flex items-center gap-2 text-sm">
                        <UserPlus size={14} />Create new donor
                      </button>
                    </div>
                  )}
                  {showNewDonorForm && (
                    <div className="mt-3 p-4 border border-slate-200 rounded-lg bg-slate-50 space-y-2">
                      <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5"><UserPlus size={14} />New Donor</h3>
                      <input type="text" value={newDonorData.name} onChange={e => setNewDonorData({ ...newDonorData, name: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Full name *" />
                      <EmailInput value={newDonorData.email} onChange={v => setNewDonorData({ ...newDonorData, email: v })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Email" />
                      <input type="tel" value={newDonorData.phone_number} onChange={e => setNewDonorData({ ...newDonorData, phone_number: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Phone" />
                      <div className="flex gap-2">
                        <button type="button" onClick={handleCreateNewDonor} className="flex-1 bg-blue-600 text-white py-1.5 rounded-lg hover:bg-blue-700 transition text-sm">Create</button>
                        <button type="button" onClick={() => setShowNewDonorForm(false)} className="flex-1 bg-slate-200 text-slate-700 py-1.5 rounded-lg hover:bg-slate-300 transition text-sm">Cancel</button>
                      </div>
                    </div>
                  )}
                  {selectedDonorObj && !showNewDonorForm && (
                    <div className="mt-1.5 text-xs text-slate-500">Selected: <span className="font-medium text-slate-700">{selectedDonorObj.name}</span></div>
                  )}
                </div>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                <input type="number" step="0.01" required value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Purpose</label>
                <input type="text" value={formData.purpose} onChange={e => setFormData({ ...formData, purpose: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="e.g. Building Fund" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Pledge Date</label>
                  <input type="date" required value={formData.pledge_date} onChange={e => setFormData({ ...formData, pledge_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                  <input type="date" value={formData.due_date} onChange={e => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium">
                  {editingPledge ? 'Update' : 'Create'} Pledge
                </button>
                <button type="button" onClick={resetForm} className="flex-1 bg-slate-200 text-slate-700 py-2 rounded-lg hover:bg-slate-300 transition text-sm">Cancel</button>
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
                <th className="px-4 py-3 text-left text-slate-500 font-medium w-28">Actions</th>
                <th className="px-5 py-3 text-left text-slate-500 font-medium">
                  <button onClick={() => handleSort('donor')} className="flex items-center gap-1 hover:text-slate-700">Donor <SortIcon field="donor" sortField={sortField} sortDir={sortDir} /></button>
                </th>
                <th className="px-5 py-3 text-left text-slate-500 font-medium">Purpose</th>
                <th className="px-5 py-3 text-left text-slate-500 font-medium">
                  <button onClick={() => handleSort('amount')} className="flex items-center gap-1 hover:text-slate-700">Amount <SortIcon field="amount" sortField={sortField} sortDir={sortDir} /></button>
                </th>
                <th className="px-5 py-3 text-left text-slate-500 font-medium">Progress</th>
                <th className="px-5 py-3 text-left text-slate-500 font-medium">
                  <button onClick={() => handleSort('due_date')} className="flex items-center gap-1 hover:text-slate-700">Due Date <SortIcon field="due_date" sortField={sortField} sortDir={sortDir} /></button>
                </th>
                <th className="px-5 py-3 text-left text-slate-500 font-medium">
                  <button onClick={() => handleSort('status')} className="flex items-center gap-1 hover:text-slate-700">Status <SortIcon field="status" sortField={sortField} sortDir={sortDir} /></button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                  {pledges.length === 0 ? 'No pledges yet.' : 'No pledges match your filters.'}
                </td></tr>
              ) : filteredSorted.map(pledge => {
                const paid = pledge.amount_paid || 0
                const pct = Math.min((paid / pledge.amount) * 100, 100)
                return (
                  <tr key={pledge.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={async () => { setViewingPledge(pledge); await loadPayments(pledge.id) }}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Payments"><DollarSign size={15} /></button>
                        <button onClick={() => editPledge(pledge)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Edit"><Edit2 size={15} /></button>
                        <button onClick={() => deletePledge(pledge.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Delete"><Trash2 size={15} /></button>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">{pledge.donors.name}</td>
                    <td className="px-5 py-3 text-slate-600">{pledge.purpose || '—'}</td>
                    <td className="px-5 py-3 text-slate-900">{formatCurrency(pledge.amount)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-200 rounded-full h-1.5 min-w-[60px]">
                          <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap">{formatCurrency(paid)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {pledge.due_date ? new Date(pledge.due_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${pledge.fulfilled ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                        {pledge.fulfilled ? <><CheckCircle size={11} />Fulfilled</> : <><XCircle size={11} />Outstanding</>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
