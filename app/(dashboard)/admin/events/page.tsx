'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import { Plus, X, Calendar, ChevronRight, PartyPopper } from 'lucide-react'

type Event = { id: string; name: string; event_date: string | null; type: string | null; notes: string | null }
type Donation = { event_id: string | null; amount: number }

const EVENT_TYPE_SUGGESTIONS = ['Dinner', 'Parlor Meeting', 'Journal Campaign', 'Annual Campaign', 'Other']

export default function EventsPage() {
  const supabase = createClient()
  const [events, setEvents] = useState<Event[]>([])
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', event_date: '', type: '', notes: '' })

  const load = useCallback(async () => {
    const [{ data: e }, { data: d }] = await Promise.all([
      supabase.from('events').select('*').order('event_date', { ascending: false, nullsFirst: false }),
      supabase.from('donations').select('event_id,amount').not('event_id', 'is', null),
    ])
    setEvents(e ?? [])
    setDonations(d ?? [])
    setLoading(false)
  }, [supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
  useEffect(() => { load() }, [load])

  function totalFor(eventId: string) {
    return donations.filter(d => d.event_id === eventId).reduce((s, d) => s + Number(d.amount), 0)
  }
  function donorCountFor(eventId: string) {
    return donations.filter(d => d.event_id === eventId).length
  }

  async function createEvent(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    const { error } = await supabase.from('events').insert([{
      name: form.name.trim(), event_date: form.event_date || null, type: form.type || null, notes: form.notes || null,
    }])
    setSaving(false)
    if (error) { alert('Error creating event.'); return }
    setForm({ name: '', event_date: '', type: '', notes: '' })
    setShowForm(false)
    load()
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Events</h1>
        <button onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? 'Cancel' : 'New Event'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createEvent} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-3">
          <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Event name (e.g. Annual Dinner 2026) *"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="grid grid-cols-2 gap-3">
            <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} list="event-type-suggestions"
              placeholder="Type (e.g. Dinner)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <datalist id="event-type-suggestions">
              {EVENT_TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
            placeholder="Notes (optional)"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          <button type="submit" disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            {saving ? 'Creating…' : 'Create Event'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center">
          <PartyPopper size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No events yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map(ev => (
            <Link key={ev.id} href={`/admin/events/${ev.id}`}
              className="flex items-center gap-4 bg-white rounded-xl border border-slate-100 shadow-sm px-5 py-4 hover:bg-slate-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900">{ev.name}</span>
                  {ev.type && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{ev.type}</span>}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                  {ev.event_date && <span className="flex items-center gap-1"><Calendar size={11} />{new Date(ev.event_date + 'T00:00:00').toLocaleDateString()}</span>}
                  <span>{donorCountFor(ev.id)} donation{donorCountFor(ev.id) === 1 ? '' : 's'}</span>
                </div>
              </div>
              <span className="font-semibold text-green-600">{formatCurrency(totalFor(ev.id))}</span>
              <ChevronRight size={16} className="text-slate-300" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
