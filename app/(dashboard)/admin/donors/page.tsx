'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Search, Plus, X, User, Mail, Phone, MapPin, Tag, Heart, Grid3x3, List, Users } from 'lucide-react'
import ExportButton from '@/components/ExportButton'
import NameInput from '@/components/NameInput'
import PhoneInput from '@/components/PhoneInput'

const DONOR_EXPORT_COLS = [
  { header: 'Name',         key: 'name' },
  { header: 'Email',        key: 'email' },
  { header: 'Phone',        key: 'phone_number' },
  { header: 'Category',     key: 'category' },
  { header: 'Relationship', key: 'relationship' },
  { header: 'Address',      key: 'address' },
  { header: 'Notes',        key: 'notes' },
]

type Donor = {
  id: string
  name: string
  email: string | null
  phone_number: string | null
  address: string | null
  category: string | null
  relationship: string | null
}

type ViewMode = 'list' | 'card'
type GroupBy = 'none' | 'category' | 'relationship'

export default function DonorsPage() {
  const router = useRouter()
  const supabase = createClient()

  const [donors, setDonors] = useState<Donor[]>([])
  const [donorCategories, setDonorCategories] = useState<string[]>(['General'])
  const [relationships, setRelationships] = useState<string[]>(['Other'])
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    address: '',
    phone_number: '',
    category: '',
    relationship: '',
  })

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase
      .from('donor_settings')
      .select('donor_categories, relationships')
      .limit(1)
      .maybeSingle()
    if (data) {
      const cats = data.donor_categories || ['General']
      const rels = data.relationships || ['Other']
      setDonorCategories(cats)
      setRelationships(rels)
      setFormData(prev => ({
        ...prev,
        category: prev.category || cats[0] || '',
        relationship: prev.relationship || rels[0] || '',
      }))
    }
  }, [supabase])

  const fetchDonors = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('donors').select('*').order('name')
    setDonors(data || [])
    setLoading(false)
  }, [supabase])

  /* eslint-disable react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await */
  useEffect(() => {
    fetchSettings()
    fetchDonors()
  }, [fetchSettings, fetchDonors])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function addDonor(e: React.FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('donors').insert([{
      name: formData.name,
      email: formData.email || null,
      address: formData.address || null,
      phone_number: formData.phone_number || null,
      category: formData.category,
      relationship: formData.relationship,
    }]).select('id').single()
    if (error) { alert('Error adding donor.'); return }
    // Best-effort — Sola client sync shouldn't block the donor record from being created.
    fetch('/api/sola/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'donor', id: data.id }),
    }).catch(err => console.warn('Sola customer sync failed:', err))
    setFormData({ name: '', email: '', address: '', phone_number: '', category: donorCategories[0] || '', relationship: relationships[0] || '' })
    setShowAddForm(false)
    fetchDonors()
  }

  const filtered = useMemo(() => donors.filter(d =>
    d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.phone_number?.includes(searchTerm) ||
    d.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.relationship?.toLowerCase().includes(searchTerm.toLowerCase())
  ), [donors, searchTerm])

  const grouped = useMemo(() => {
    if (groupBy === 'none') return null
    const map = new Map<string, Donor[]>()
    for (const d of filtered) {
      const key = (groupBy === 'category' ? d.category : d.relationship) || 'Other'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(d)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered, groupBy])

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Donors</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode */}
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors text-sm ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
            >
              <List size={16} /> List
            </button>
            <button
              onClick={() => setViewMode('card')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors text-sm ${viewMode === 'card' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
            >
              <Grid3x3 size={16} /> Cards
            </button>
          </div>
          {/* Group by */}
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setGroupBy('none')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${groupBy === 'none' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Users size={14} /> All
            </button>
            <button
              onClick={() => setGroupBy('category')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${groupBy === 'category' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Tag size={14} /> By Category
            </button>
            <button
              onClick={() => setGroupBy('relationship')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${groupBy === 'relationship' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Heart size={14} /> By Relationship
            </button>
          </div>
          <ExportButton data={filtered} columns={DONOR_EXPORT_COLS} filename="donors" title="Donor List" />
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium"
          >
            {showAddForm ? <X size={16} /> : <Plus size={16} />}
            {showAddForm ? 'Cancel' : 'Add Donor'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold mb-4 text-slate-900">Add New Donor</h3>
          <form onSubmit={addDonor} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
              <NameInput required value={formData.name}
                onChange={v => setFormData({ ...formData, name: v })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                placeholder="Full name" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input type="email" value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder="donor@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <PhoneInput value={formData.phone_number}
                  onChange={v => setFormData({ ...formData, phone_number: v })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder="(555) 123-4567" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
              <textarea value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                rows={2} placeholder="123 Main St, City, State ZIP" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                <select required value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm">
                  {donorCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Relationship *</label>
                <select required value={formData.relationship}
                  onChange={e => setFormData({ ...formData, relationship: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm">
                  {relationships.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium">
              Add Donor
            </button>
          </form>
        </div>
      )}

      <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by name, email, phone, category..."
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading donors...</div>
      ) : grouped ? (
        /* ── Grouped view ── */
        <div className="space-y-5">
          {grouped.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              {searchTerm ? 'No donors match your search.' : 'No donors yet.'}
            </div>
          )}
          {grouped.map(([label, groupDonors]) => (
            <div key={label} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {groupBy === 'category'
                    ? <Tag size={14} className="text-blue-500" />
                    : <Heart size={14} className="text-green-500" />}
                  <span className="font-semibold text-slate-800 text-sm">{label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 font-medium">
                    {groupDonors.length} donor{groupDonors.length !== 1 ? 's' : ''}
                  </span>
                  <ExportButton
                    data={groupDonors}
                    columns={DONOR_EXPORT_COLS}
                    filename={`donors-${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}
                    title={`Donors — ${label}`}
                    size="sm"
                  />
                </div>
              </div>
              {viewMode === 'list' ? (
                <DonorTable donors={groupDonors} onNavigate={id => router.push(`/admin/donors/${id}`)} searchTerm={searchTerm} />
              ) : (
                <div className="p-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {groupDonors.map(donor => (
                    <DonorCard key={donor.id} donor={donor} onClick={() => router.push(`/admin/donors/${donor.id}`)} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : viewMode === 'list' ? (
        <DonorTable donors={filtered} onNavigate={id => router.push(`/admin/donors/${id}`)} searchTerm={searchTerm} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(donor => (
            <DonorCard key={donor.id} donor={donor} onClick={() => router.push(`/admin/donors/${donor.id}`)} />
          ))}
          {!filtered.length && (
            <div className="col-span-full text-center py-12 text-slate-400">
              {searchTerm ? 'No donors match your search.' : 'No donors yet.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DonorTable({ donors, onNavigate, searchTerm }: { donors: Donor[]; onNavigate: (id: string) => void; searchTerm: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className="text-left px-5 py-3 text-slate-500 font-medium">Name</th>
            <th className="text-left px-5 py-3 text-slate-500 font-medium hidden md:table-cell">Contact</th>
            <th className="text-left px-5 py-3 text-slate-500 font-medium hidden lg:table-cell">Category</th>
            <th className="text-left px-5 py-3 text-slate-500 font-medium hidden lg:table-cell">Relationship</th>
          </tr>
        </thead>
        <tbody>
          {donors.map(donor => (
            <tr key={donor.id} onClick={() => onNavigate(donor.id)}
              className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition">
              <td className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 p-1.5 rounded-lg"><User className="text-blue-600" size={16} /></div>
                  <span className="font-medium text-slate-900">{donor.name}</span>
                </div>
              </td>
              <td className="px-5 py-3 hidden md:table-cell text-slate-600">
                {donor.email && <div className="flex items-center gap-1.5 mb-0.5"><Mail size={13} className="text-slate-400" />{donor.email}</div>}
                {donor.phone_number && <div className="flex items-center gap-1.5"><Phone size={13} className="text-slate-400" />{donor.phone_number}</div>}
                {!donor.email && !donor.phone_number && <span className="text-slate-400">—</span>}
              </td>
              <td className="px-5 py-3 hidden lg:table-cell">
                {donor.category && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                    <Tag size={10} />{donor.category}
                  </span>
                )}
              </td>
              <td className="px-5 py-3 hidden lg:table-cell">
                {donor.relationship && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                    <Heart size={10} />{donor.relationship}
                  </span>
                )}
              </td>
            </tr>
          ))}
          {!donors.length && (
            <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">
              {searchTerm ? 'No donors match your search.' : 'No donors yet. Add your first donor.'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function DonorCard({ donor, onClick }: { donor: Donor; onClick: () => void }) {
  return (
    <div onClick={onClick}
      className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition cursor-pointer">
      <div className="flex items-start gap-3">
        <div className="bg-blue-100 p-2 rounded-lg"><User className="text-blue-600" size={20} /></div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 truncate">{donor.name}</h3>
          <div className="flex gap-2 mt-1.5 mb-2 flex-wrap">
            {donor.category && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                <Tag size={10} />{donor.category}
              </span>
            )}
            {donor.relationship && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                <Heart size={10} />{donor.relationship}
              </span>
            )}
          </div>
          <div className="space-y-1 text-sm text-slate-600">
            {donor.email && <div className="flex items-center gap-1.5"><Mail size={13} /><span className="truncate">{donor.email}</span></div>}
            {donor.phone_number && <div className="flex items-center gap-1.5"><Phone size={13} />{donor.phone_number}</div>}
            {donor.address && <div className="flex items-start gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{donor.address}</span></div>}
          </div>
        </div>
      </div>
    </div>
  )
}
