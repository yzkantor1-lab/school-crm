'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import { Search, DollarSign, Calendar, CreditCard, FileText, UserPlus, X, Plus } from 'lucide-react'

type Donor = { id: string; name: string; email: string | null }
type Donation = {
  id: string; amount: number; donation_method: string; donation_date: string
  purpose: string; notes: string | null; archived: boolean
  donors: { name: string }
}

export default function DonationsPage() {
  const supabase = createClient()
  const router = useRouter()

  const [donors, setDonors] = useState<Donor[]>([])
  const [donations, setDonations] = useState<Donation[]>([])
  const [donationMethods, setDonationMethods] = useState<string[]>(['Cash'])
  const [donationPurposes, setDonationPurposes] = useState<string[]>(['General Fund'])
  const [donorCategories, setDonorCategories] = useState<string[]>(['General'])
  const [relationships, setRelationships] = useState<string[]>(['Other'])
  const [searchTerm, setSearchTerm] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedDonor, setSelectedDonor] = useState<Donor | null>(null)
  const [showNewDonorForm, setShowNewDonorForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [newDonorData, setNewDonorData] = useState({ name: '', email: '', phone_number: '', address: '', category: '', relationship: '' })
  const [formData, setFormData] = useState({
    amount: '', donation_method: '', donation_date: new Date().toISOString().split('T')[0], purpose: '', notes: ''
  })

  useEffect(() => { fetchSettings(); fetchDonors(); fetchDonations() }, [])

  async function fetchSettings() {
    const { data } = await supabase.from('donor_settings').select('*').limit(1).maybeSingle()
    if (data) {
      const methods = data.donation_methods || ['Cash']
      const purposes = data.donation_purposes || ['General Fund']
      const cats = data.donor_categories || ['General']
      const rels = data.relationships || ['Other']
      setDonationMethods(methods); setDonationPurposes(purposes); setDonorCategories(cats); setRelationships(rels)
      setFormData(prev => ({ ...prev, donation_method: prev.donation_method || methods[0] || '', purpose: prev.purpose || purposes[0] || '' }))
      setNewDonorData(prev => ({ ...prev, category: prev.category || cats[0] || '', relationship: prev.relationship || rels[0] || '' }))
    }
  }

  async function fetchDonors() {
    const { data } = await supabase.from('donors').select('id, name, email').order('name')
    setDonors(data || [])
  }

  async function fetchDonations() {
    setLoading(true)
    const { data } = await supabase.from('donations').select('*, donors(name)').eq('archived', false).order('donation_date', { ascending: false }).limit(50)
    setDonations(data || [])
    setLoading(false)
  }

  async function handleAddNewDonor(e: React.FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('donors').insert([{
      name: newDonorData.name, email: newDonorData.email || null, phone_number: newDonorData.phone_number || null,
      address: newDonorData.address || null, category: newDonorData.category, relationship: newDonorData.relationship,
    }]).select().single()
    if (error) { alert('Error adding donor.'); return }
    if (data) {
      setSelectedDonor(data); setSearchTerm(data.name); setShowNewDonorForm(false)
      setNewDonorData({ name: '', email: '', phone_number: '', address: '', category: donorCategories[0] || '', relationship: relationships[0] || '' })
      fetchDonors()
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedDonor) { alert('Please select a donor'); return }
    setSubmitting(true)
    const { error } = await supabase.from('donations').insert([{
      donor_id: selectedDonor.id, amount: parseFloat(formData.amount), donation_method: formData.donation_method,
      donation_date: formData.donation_date, purpose: formData.purpose, notes: formData.notes || null,
    }])
    setSubmitting(false)
    if (error) { alert('Error recording donation.'); return }
    setSuccess(true)
    setFormData({ amount: '', donation_method: donationMethods[0] || '', donation_date: new Date().toISOString().split('T')[0], purpose: donationPurposes[0] || '', notes: '' })
    setSearchTerm(''); setSelectedDonor(null)
    fetchDonations()
    setTimeout(() => setSuccess(false), 3000)
  }

  const filteredDonors = donors.filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase()))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Donations</h1>

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm font-medium">
          Donation recorded successfully!
        </div>
      )}

      {/* Record Donation Form */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Record Donation</h2>

        {showNewDonorForm && (
          <div className="bg-slate-50 p-4 rounded-lg mb-4 border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-900 text-sm">Add New Donor</h3>
              <button onClick={() => setShowNewDonorForm(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleAddNewDonor} className="space-y-3">
              <input type="text" required value={newDonorData.name} onChange={e => setNewDonorData({ ...newDonorData, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Full name *" />
              <div className="grid grid-cols-2 gap-3">
                <input type="email" value={newDonorData.email} onChange={e => setNewDonorData({ ...newDonorData, email: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Email" />
                <input type="tel" value={newDonorData.phone_number} onChange={e => setNewDonorData({ ...newDonorData, phone_number: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Phone" />
                <select value={newDonorData.category} onChange={e => setNewDonorData({ ...newDonorData, category: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  {donorCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={newDonorData.relationship} onChange={e => setNewDonorData({ ...newDonorData, relationship: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  {relationships.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <button type="submit" className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition text-sm font-medium">
                Add Donor & Select
              </button>
            </form>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-slate-700">Select Donor *</label>
              <button type="button" onClick={() => setShowNewDonorForm(!showNewDonorForm)}
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
                <UserPlus size={14} />Add New Donor
              </button>
            </div>
            <div className="relative">
              <input type="text" required value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setShowSuggestions(true); setSelectedDonor(null) }}
                onFocus={() => setShowSuggestions(true)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Type donor name..." />
              {showSuggestions && searchTerm && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filteredDonors.length > 0 ? filteredDonors.map(d => (
                    <button key={d.id} type="button" onClick={() => { setSelectedDonor(d); setSearchTerm(d.name); setShowSuggestions(false) }}
                      className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition border-b border-slate-50 last:border-0 text-sm">
                      <div className="font-medium text-slate-900">{d.name}</div>
                      {d.email && <div className="text-slate-500 text-xs">{d.email}</div>}
                    </button>
                  )) : (
                    <div className="px-4 py-3 text-slate-500 text-sm text-center">No donors found. Click "Add New Donor" above.</div>
                  )}
                </div>
              )}
            </div>
            {selectedDonor && (
              <div className="mt-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                <span className="font-medium">Selected: </span>{selectedDonor.name}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5"><DollarSign size={13} />Amount *</label>
              <input type="number" required step="0.01" min="0.01" value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="0.00" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5"><Calendar size={13} />Date *</label>
              <input type="date" required value={formData.donation_date}
                onChange={e => setFormData({ ...formData, donation_date: e.target.value })}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5"><CreditCard size={13} />Payment Method *</label>
            <select required value={formData.donation_method} onChange={e => setFormData({ ...formData, donation_method: e.target.value })}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              {donationMethods.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5"><FileText size={13} />Purpose *</label>
            <select required value={formData.purpose} onChange={e => setFormData({ ...formData, purpose: e.target.value })}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              {donationPurposes.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5">Notes</label>
            <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" rows={2} />
          </div>

          <button type="submit" disabled={submitting}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 transition font-medium text-sm disabled:opacity-60">
            {submitting ? 'Recording...' : 'Record Donation'}
          </button>
        </form>
      </div>

      {/* Recent Donations */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Recent Donations</h2>
          <span className="text-sm text-slate-500">{donations.length} records</span>
        </div>
        {loading ? (
          <div className="py-10 text-center text-slate-400">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Donor</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Date</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium hidden md:table-cell">Purpose</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium hidden md:table-cell">Method</th>
                <th className="text-right px-5 py-3 text-slate-500 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {donations.map(d => (
                <tr key={d.id} onClick={() => router.push(`/admin/donors/${(d as any).donor_id}`)}
                  className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition">
                  <td className="px-5 py-3 font-medium text-slate-900">{d.donors.name}</td>
                  <td className="px-5 py-3 text-slate-600">{new Date(d.donation_date).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-slate-600 hidden md:table-cell">{d.purpose}</td>
                  <td className="px-5 py-3 text-slate-600 hidden md:table-cell">{d.donation_method}</td>
                  <td className="px-5 py-3 text-right font-semibold text-green-600">{formatCurrency(Number(d.amount))}</td>
                </tr>
              ))}
              {!donations.length && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No donations yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
