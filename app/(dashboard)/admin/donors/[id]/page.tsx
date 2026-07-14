'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import {
  ArrowLeft, Edit2, Save, X, Trash2, DollarSign, Calendar,
  CreditCard, FileText, User, Mail, Phone, MapPin, Tag, Heart, Archive, ArchiveRestore
} from 'lucide-react'

type Donor = {
  id: string; name: string; email: string | null; phone_number: string | null
  address: string | null; category: string | null; relationship: string | null
}
type Donation = {
  id: string; amount: number; donation_method: string; donation_date: string
  purpose: string; notes: string | null; archived: boolean
}

export default function DonorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [donor, setDonor] = useState<Donor | null>(null)
  const [donations, setDonations] = useState<Donation[]>([])
  const [donorCategories, setDonorCategories] = useState<string[]>(['General'])
  const [relationships, setRelationships] = useState<string[]>(['Other'])
  const [donationMethods, setDonationMethods] = useState<string[]>(['Cash'])
  const [donationPurposes, setDonationPurposes] = useState<string[]>(['General Fund'])
  const [loading, setLoading] = useState(true)
  const [isEditingDonor, setIsEditingDonor] = useState(false)
  const [editingDonationId, setEditingDonationId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [donorForm, setDonorForm] = useState({ name: '', email: '', phone_number: '', address: '', category: '', relationship: '' })
  const [donationForm, setDonationForm] = useState({ amount: '', donation_method: '', donation_date: '', purpose: '', notes: '' })

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase.from('donor_settings').select('*').limit(1).maybeSingle()
    if (data) {
      setDonorCategories(data.donor_categories || ['General'])
      setRelationships(data.relationships || ['Other'])
      setDonationMethods(data.donation_methods || ['Cash'])
      setDonationPurposes(data.donation_purposes || ['General Fund'])
    }
  }, [supabase])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: d }, { data: dn }] = await Promise.all([
      supabase.from('donors').select('*').eq('id', id).maybeSingle(),
      supabase.from('donations').select('*').eq('donor_id', id).order('donation_date', { ascending: false }),
    ])
    if (d) {
      setDonor(d)
      setDonorForm({ name: d.name, email: d.email || '', phone_number: d.phone_number || '', address: d.address || '', category: d.category || 'General', relationship: d.relationship || 'Other' })
    }
    setDonations(dn || [])
    setLoading(false)
  }, [id, supabase])

  /* eslint-disable react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await */
  useEffect(() => {
    fetchSettings()
    fetchData()
  }, [fetchSettings, fetchData])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function updateDonor() {
    if (!donor) return
    const { error } = await supabase.from('donors').update({
      name: donorForm.name, email: donorForm.email || null, phone_number: donorForm.phone_number || null,
      address: donorForm.address || null, category: donorForm.category, relationship: donorForm.relationship,
    }).eq('id', donor.id)
    if (error) { alert('Error updating donor.'); return }
    setIsEditingDonor(false)
    fetchData()
  }

  async function deleteDonor() {
    if (!donor) return
    if (!confirm(`Delete ${donor.name}? This will also delete all their donations.`)) return
    const { error } = await supabase.from('donors').delete().eq('id', donor.id)
    if (error) { alert('Error deleting donor.'); return }
    router.push('/admin/donors')
  }

  async function updateDonation(donationId: string) {
    const { error } = await supabase.from('donations').update({
      amount: parseFloat(donationForm.amount), donation_method: donationForm.donation_method,
      donation_date: donationForm.donation_date, purpose: donationForm.purpose, notes: donationForm.notes || null,
    }).eq('id', donationId)
    if (error) { alert('Error updating donation.'); return }
    setEditingDonationId(null)
    fetchData()
  }

  async function deleteDonation(donationId: string) {
    if (!confirm('Delete this donation?')) return
    await supabase.from('donations').delete().eq('id', donationId)
    fetchData()
  }

  async function toggleArchive(donationId: string, archived: boolean) {
    await supabase.from('donations').update({ archived: !archived }).eq('id', donationId)
    fetchData()
  }

  const shown = donations.filter(d => showArchived ? d.archived : !d.archived)
  const totalDonated = donations.filter(d => !d.archived).reduce((s, d) => s + Number(d.amount), 0)

  if (loading) return <div className="text-center py-12 text-slate-500">Loading...</div>
  if (!donor) return <div className="text-center py-12 text-slate-500">Donor not found.</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/admin/donors')} className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Donor Details</h1>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-3 rounded-xl"><User className="text-blue-600" size={24} /></div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">{donor.name}</h2>
              <div className="flex gap-2 mt-1 flex-wrap">
                {donor.category && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium"><Tag size={10} />{donor.category}</span>}
                {donor.relationship && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium"><Heart size={10} />{donor.relationship}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {!isEditingDonor ? (
              <>
                <button onClick={() => setIsEditingDonor(true)} className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition text-sm"><Edit2 size={14} />Edit</button>
                <button onClick={deleteDonor} className="flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 transition text-sm"><Trash2 size={14} />Delete</button>
              </>
            ) : (
              <>
                <button onClick={updateDonor} className="flex items-center gap-2 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition text-sm"><Save size={14} />Save</button>
                <button onClick={() => setIsEditingDonor(false)} className="flex items-center gap-2 bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-300 transition text-sm"><X size={14} />Cancel</button>
              </>
            )}
          </div>
        </div>

        {isEditingDonor ? (
          <div className="space-y-3 mt-4">
            <input type="text" required value={donorForm.name} onChange={e => setDonorForm({ ...donorForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Name *" />
            <div className="grid grid-cols-2 gap-3">
              <input type="email" value={donorForm.email} onChange={e => setDonorForm({ ...donorForm, email: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Email" />
              <input type="tel" value={donorForm.phone_number} onChange={e => setDonorForm({ ...donorForm, phone_number: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Phone" />
            </div>
            <textarea value={donorForm.address} onChange={e => setDonorForm({ ...donorForm, address: e.target.value })} rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Address" />
            <div className="grid grid-cols-2 gap-3">
              <select value={donorForm.category} onChange={e => setDonorForm({ ...donorForm, category: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                {donorCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={donorForm.relationship} onChange={e => setDonorForm({ ...donorForm, relationship: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                {relationships.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 mt-4 text-sm text-slate-700">
            {donor.email && <div className="flex items-center gap-2"><Mail size={14} className="text-slate-400" />{donor.email}</div>}
            {donor.phone_number && <div className="flex items-center gap-2"><Phone size={14} className="text-slate-400" />{donor.phone_number}</div>}
            {donor.address && <div className="flex items-start gap-2"><MapPin size={14} className="text-slate-400 mt-0.5" />{donor.address}</div>}
          </div>
        )}
      </div>

      <div className="bg-gradient-to-br from-green-500 to-green-600 text-white p-6 rounded-xl shadow-sm">
        <div className="flex items-center gap-2 mb-1"><DollarSign size={20} /><span className="font-semibold">Total Donated</span></div>
        <p className="text-4xl font-bold">{formatCurrency(totalDonated)}</p>
        <p className="text-green-100 text-sm mt-1">{donations.length} donation{donations.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900">Donation History</h3>
          <button onClick={() => setShowArchived(!showArchived)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition text-sm ${showArchived ? 'bg-slate-700 text-white hover:bg-slate-800' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            <Archive size={14} />{showArchived ? 'Show Active' : 'Show Archived'}
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="text-center py-8 text-slate-400">{showArchived ? 'No archived donations.' : 'No donations yet.'}</p>
        ) : (
          <div className="space-y-3">
            {shown.map(donation => (
              <div key={donation.id} className="border border-slate-100 rounded-lg p-4 hover:bg-slate-50 transition">
                {editingDonationId === donation.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <input type="number" step="0.01" required value={donationForm.amount} onChange={e => setDonationForm({ ...donationForm, amount: e.target.value })}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Amount" />
                      <input type="date" required value={donationForm.donation_date} onChange={e => setDonationForm({ ...donationForm, donation_date: e.target.value })}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                      <select value={donationForm.donation_method} onChange={e => setDonationForm({ ...donationForm, donation_method: e.target.value })}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                        {donationMethods.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <select value={donationForm.purpose} onChange={e => setDonationForm({ ...donationForm, purpose: e.target.value })}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                        {donationPurposes.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <textarea value={donationForm.notes} onChange={e => setDonationForm({ ...donationForm, notes: e.target.value })} rows={2}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Notes" />
                    <div className="flex gap-2">
                      <button onClick={() => updateDonation(donation.id)} className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition text-sm"><Save size={13} />Save</button>
                      <button onClick={() => setEditingDonationId(null)} className="flex items-center gap-1.5 bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-300 transition text-sm"><X size={13} />Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-bold text-green-600 text-lg">{formatCurrency(Number(donation.amount))}</span>
                        <span className="text-sm text-slate-500 flex items-center gap-1"><Calendar size={12} />{new Date(donation.donation_date).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-slate-600 flex-wrap">
                        <span className="flex items-center gap-1"><CreditCard size={12} />{donation.donation_method}</span>
                        <span className="flex items-center gap-1"><FileText size={12} />{donation.purpose}</span>
                      </div>
                      {donation.notes && <p className="text-sm text-slate-500 mt-1">{donation.notes}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => { setEditingDonationId(donation.id); setDonationForm({ amount: donation.amount.toString(), donation_method: donation.donation_method, donation_date: donation.donation_date, purpose: donation.purpose, notes: donation.notes || '' }) }}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"><Edit2 size={15} /></button>
                      <button onClick={() => toggleArchive(donation.id, donation.archived)}
                        className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition">{donation.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}</button>
                      <button onClick={() => deleteDonation(donation.id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"><Trash2 size={15} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
