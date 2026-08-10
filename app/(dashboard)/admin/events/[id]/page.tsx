'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import { ArrowLeft, Calendar, DollarSign, Edit2, Save, X, Trash2, ExternalLink } from 'lucide-react'

type Event = { id: string; name: string; event_date: string | null; type: string | null; notes: string | null }
type Donation = {
  id: string; donor_id: string; amount: number; donation_date: string; source: string
  donors: { id: string; name: string } | null
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [event, setEvent] = useState<Event | null>(null)
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', event_date: '', type: '', notes: '' })

  const load = useCallback(async () => {
    const [{ data: ev }, { data: d }] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).maybeSingle(),
      supabase.from('donations').select('id,donor_id,amount,donation_date,source,donors(id,name)').eq('event_id', id).order('donation_date', { ascending: false }),
    ])
    if (ev) { setEvent(ev); setForm({ name: ev.name, event_date: ev.event_date || '', type: ev.type || '', notes: ev.notes || '' }) }
    setDonations((d ?? []) as unknown as Donation[])
    setLoading(false)
  }, [id, supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
  useEffect(() => { load() }, [load])

  async function save() {
    const { error } = await supabase.from('events').update({
      name: form.name.trim(), event_date: form.event_date || null, type: form.type || null, notes: form.notes || null,
    }).eq('id', id)
    if (error) { alert('Error saving event.'); return }
    setEditing(false)
    load()
  }

  async function deleteEvent() {
    if (!event) return
    if (!confirm(`Delete "${event.name}"? Donations already recorded for it will stay on file but lose their event link.`)) return
    await supabase.from('events').delete().eq('id', id)
    router.push('/admin/events')
  }

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
  if (!event) return <div className="text-center py-12 text-slate-400 text-sm">Event not found.</div>

  const total = donations.reduce((s, d) => s + Number(d.amount), 0)
  const uniqueDonors = new Set(donations.map(d => d.donor_id)).size

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/admin/events" className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm transition-colors w-fit">
        <ArrowLeft size={15} /> Events
      </Link>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
        {editing ? (
          <div className="space-y-3">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            <div className="flex gap-2">
              <button onClick={save} className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"><Save size={14} />Save</button>
              <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium"><X size={14} />Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900">{event.name}</h1>
                {event.type && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{event.type}</span>}
              </div>
              {event.event_date && (
                <p className="text-sm text-slate-500 flex items-center gap-1 mt-1"><Calendar size={13} />{new Date(event.event_date + 'T00:00:00').toLocaleDateString()}</p>
              )}
              {event.notes && <p className="text-sm text-slate-500 mt-2">{event.notes}</p>}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"><Edit2 size={14} />Edit</button>
              <button onClick={deleteEvent} className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"><Trash2 size={14} />Delete</button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-gradient-to-br from-green-500 to-green-600 text-white p-6 rounded-xl shadow-sm">
        <div className="flex items-center gap-2 mb-1"><DollarSign size={20} /><span className="font-semibold">Total Raised</span></div>
        <p className="text-4xl font-bold">{formatCurrency(total)}</p>
        <p className="text-green-100 text-sm mt-1">{donations.length} donation{donations.length === 1 ? '' : 's'} · {uniqueDonors} donor{uniqueDonors === 1 ? '' : 's'}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Donors</h2>
        </div>
        {donations.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm">No donations tied to this event yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="text-left px-5 py-2.5 font-medium">Donor</th>
                <th className="text-left px-5 py-2.5 font-medium">Date</th>
                <th className="text-left px-5 py-2.5 font-medium">Source</th>
                <th className="text-right px-5 py-2.5 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {donations.map(d => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    {d.donors ? (
                      <Link href={`/admin/donors/${d.donors.id}`} className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                        {d.donors.name} <ExternalLink size={11} />
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-5 py-2.5 text-slate-600">{new Date(d.donation_date + 'T00:00:00').toLocaleDateString()}</td>
                  <td className="px-5 py-2.5 text-slate-400 capitalize">{d.source}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-green-600">{formatCurrency(Number(d.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
