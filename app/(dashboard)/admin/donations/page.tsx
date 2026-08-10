'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import { DollarSign, Calendar, CreditCard, FileText, UserPlus, X, AlertTriangle, PartyPopper } from 'lucide-react'

type Donor = { id: string; name: string; email: string | null }
type StudentParent = { id: string; first_name: string; last_name: string; father_name: string | null; mother_name: string | null }
type EventOption = { id: string; name: string }
type Donation = {
  id: string; donor_id: string; amount: number; donation_method: string; donation_date: string
  purpose: string; notes: string | null; archived: boolean; category: string | null; source: string
  donors: { name: string }
  events: { name: string } | null
}

const DONATION_CATEGORIES = [
  { value: 'one_time', label: 'One-Time Donation' },
  { value: 'monthly_recurring', label: 'Monthly Recurring Donation' },
  { value: 'event', label: 'Event Donation' },
]

function normalizeName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
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
  const [events, setEvents] = useState<EventOption[]>([])
  const [studentParents, setStudentParents] = useState<StudentParent[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedDonor, setSelectedDonor] = useState<Donor | null>(null)
  const [showNewDonorForm, setShowNewDonorForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [newDonorData, setNewDonorData] = useState({ name: '', email: '', phone_number: '', address: '', category: '', relationship: '' })
  const [formData, setFormData] = useState({
    amount: '', donation_method: '', donation_date: new Date().toISOString().split('T')[0], purpose: '', notes: '',
    category: 'one_time', event_id: '',
  })

  // Warn before creating a possible duplicate contact — matches by exact
  // normalized name against existing donors, or against a student's parent
  // fields (a common case: a parent's first donation, but they're already a
  // tuition contact). Never auto-links — just surfaces the option. Cheap
  // enough to compute inline each render rather than memoize.
  function findNameMatch() {
    const q = normalizeName(newDonorData.name)
    if (q.length < 3) return null
    const existingDonor = donors.find(d => normalizeName(d.name) === q)
    if (existingDonor) return { kind: 'donor' as const, donor: existingDonor }
    for (const s of studentParents) {
      if (s.father_name && normalizeName(s.father_name) === q) return { kind: 'parent' as const, student: s, parentName: s.father_name }
      if (s.mother_name && normalizeName(s.mother_name) === q) return { kind: 'parent' as const, student: s, parentName: s.mother_name }
    }
    return null
  }
  const nameMatch = findNameMatch()

  const fetchSettings = useCallback(async () => {
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
  }, [supabase])

  const fetchDonors = useCallback(async () => {
    const { data } = await supabase.from('donors').select('id, name, email').order('name')
    setDonors(data || [])
  }, [supabase])

  const fetchEvents = useCallback(async () => {
    const { data } = await supabase.from('events').select('id,name').order('event_date', { ascending: false })
    setEvents(data ?? [])
  }, [supabase])

  const fetchStudentParents = useCallback(async () => {
    const { data } = await supabase.from('students').select('id,first_name,last_name,father_name,mother_name')
    setStudentParents((data ?? []) as StudentParent[])
  }, [supabase])

  const fetchDonations = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('donations').select('*, donors(name), events(name)').eq('archived', false).order('donation_date', { ascending: false }).limit(50)
    setDonations((data ?? []) as unknown as Donation[])
    setLoading(false)
  }, [supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await
  useEffect(() => { fetchSettings(); fetchDonors(); fetchDonations(); fetchEvents(); fetchStudentParents() }, [fetchSettings, fetchDonors, fetchDonations, fetchEvents, fetchStudentParents])

  async function handleAddNewDonor(e: React.FormEvent) {
    e.preventDefault()
    const linkedStudentId = nameMatch?.kind === 'parent' ? nameMatch.student.id : null
    const { data, error } = await supabase.from('donors').insert([{
      name: newDonorData.name, email: newDonorData.email || null, phone_number: newDonorData.phone_number || null,
      address: newDonorData.address || null, category: newDonorData.category,
      relationship: linkedStudentId ? 'Parent' : newDonorData.relationship,
    }]).select().single()
    if (error) { alert('Error adding donor.'); return }
    if (data) {
      if (linkedStudentId) await supabase.from('donor_students').upsert([{ donor_id: data.id, student_id: linkedStudentId }], { onConflict: 'donor_id,student_id' })
      setSelectedDonor(data); setSearchTerm(data.name); setShowNewDonorForm(false)
      setNewDonorData({ name: '', email: '', phone_number: '', address: '', category: donorCategories[0] || '', relationship: relationships[0] || '' })
      fetchDonors()
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedDonor) { alert('Please select a donor'); return }
    if (formData.category === 'event' && !formData.event_id) { alert('Please select which event this donation is for.'); return }
    setSubmitting(true)
    const { error } = await supabase.from('donations').insert([{
      donor_id: selectedDonor.id, amount: parseFloat(formData.amount), donation_method: formData.donation_method,
      donation_date: formData.donation_date, purpose: formData.purpose, notes: formData.notes || null,
      category: formData.category, event_id: formData.category === 'event' ? formData.event_id : null, source: 'manual',
    }])
    setSubmitting(false)
    if (error) { alert('Error recording donation.'); return }
    setSuccess(true)
    setFormData({ amount: '', donation_method: donationMethods[0] || '', donation_date: new Date().toISOString().split('T')[0], purpose: donationPurposes[0] || '', notes: '', category: 'one_time', event_id: '' })
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
              {nameMatch?.kind === 'donor' && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                  <span className="flex-1">
                    A donor named &quot;{nameMatch.donor.name}&quot; already exists — this looks like it might be the same person.
                  </span>
                  <button type="button"
                    onClick={() => { setSelectedDonor(nameMatch.donor); setSearchTerm(nameMatch.donor.name); setShowNewDonorForm(false) }}
                    className="text-amber-900 underline font-medium flex-shrink-0">Use existing instead</button>
                </div>
              )}
              {nameMatch?.kind === 'parent' && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    &quot;{nameMatch.parentName}&quot; is already on file as a parent of {nameMatch.student.first_name} {nameMatch.student.last_name} in Tuition —
                    submitting will create their donor contact linked to that student.
                  </span>
                </div>
              )}
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
                    <div className="px-4 py-3 text-slate-500 text-sm text-center">No donors found. Click &quot;Add New Donor&quot; above.</div>
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
            <label className="text-sm font-medium text-slate-700 mb-1.5">Category *</label>
            <select required value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value, event_id: e.target.value === 'event' ? formData.event_id : '' })}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              {DONATION_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {formData.category === 'event' && (
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5"><PartyPopper size={13} />Event *</label>
              {events.length ? (
                <select required value={formData.event_id} onChange={e => setFormData({ ...formData, event_id: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                  <option value="">— select event —</option>
                  {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              ) : (
                <Link href="/admin/events" className="block px-3 py-2.5 border border-amber-200 bg-amber-50 rounded-lg text-sm text-amber-700">
                  No events yet — create one first →
                </Link>
              )}
            </div>
          )}

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
                <th className="text-left px-5 py-3 text-slate-500 font-medium hidden lg:table-cell">Category</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium hidden md:table-cell">Method</th>
                <th className="text-right px-5 py-3 text-slate-500 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {donations.map(d => (
                <tr key={d.id} onClick={() => router.push(`/admin/donors/${d.donor_id}`)}
                  className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition">
                  <td className="px-5 py-3 font-medium text-slate-900">{d.donors.name}</td>
                  <td className="px-5 py-3 text-slate-600">{new Date(d.donation_date).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-slate-600 hidden md:table-cell">{d.purpose}</td>
                  <td className="px-5 py-3 text-slate-600 hidden lg:table-cell">
                    {d.events?.name ?? DONATION_CATEGORIES.find(c => c.value === d.category)?.label ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600 hidden md:table-cell">{d.donation_method}</td>
                  <td className="px-5 py-3 text-right font-semibold text-green-600">{formatCurrency(Number(d.amount))}</td>
                </tr>
              ))}
              {!donations.length && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No donations yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
