'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Plus } from 'lucide-react'

export default function GuardianForm() {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone_primary: '',
    relationship: '', address_line1: '', city: '', state: '', zip: '', notes: '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || null]))
    const { error } = await supabase.from('guardians').insert([payload])
    if (error) { setError(error.message); setLoading(false) }
    else { setOpen(false); setForm({ first_name: '', last_name: '', email: '', phone_primary: '', relationship: '', address_line1: '', city: '', state: '', zip: '', notes: '' }); router.refresh() }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition h-fit">
      <Plus size={16} /> Add Guardian
    </button>
  )

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-3">
      <h2 className="font-semibold text-slate-900">New Guardian</h2>
      {[['First Name *', 'first_name', true], ['Last Name *', 'last_name', true], ['Email', 'email', false], ['Phone', 'phone_primary', false], ['Address', 'address_line1', false], ['City', 'city', false], ['State', 'state', false], ['ZIP', 'zip', false]].map(([label, key, req]) => (
        <div key={key as string}>
          <label className="block text-xs font-medium text-slate-500 mb-1">{label as string}</label>
          <input value={(form as any)[key as string]} onChange={e => set(key as string, e.target.value)} required={req as boolean}
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      ))}
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Relationship</label>
        <select value={form.relationship} onChange={e => set('relationship', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Select…</option>
          <option value="father">Father</option><option value="mother">Mother</option><option value="guardian">Guardian</option><option value="other">Other</option>
        </select>
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-4 py-2 rounded-lg disabled:opacity-50">
          {loading ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-600 text-xs font-medium px-4 py-2 rounded-lg border border-slate-200">Cancel</button>
      </div>
    </form>
  )
}
