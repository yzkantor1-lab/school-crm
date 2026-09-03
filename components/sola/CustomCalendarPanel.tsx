'use client'

import { useEffect, useState, useCallback } from 'react'
import { Pencil, Check, X, Trash2, Loader2 } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

type Entry = {
  id: string
  period_date: string
  amount: number
  status: 'planned' | 'scheduled' | 'cancelled'
  payment_schedule_id: string | null
  notes: string | null
}
type Calendar = {
  id: string
  purpose: string
  mode: 'auto_charge' | 'planning_only'
  status: 'active' | 'cancelled'
  custom_payment_calendar_entries: Entry[]
}

const STATUS_META: Record<Entry['status'], { label: string; badge: string }> = {
  planned: { label: 'Planned', badge: 'bg-slate-100 text-slate-600' },
  scheduled: { label: 'Auto-charging', badge: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'Cancelled', badge: 'bg-slate-100 text-slate-400' },
}

type Props = {
  ownerType: 'student' | 'donor'
  ownerId: string
  purpose: string
  refreshKey?: number
}

// Shows any custom per-period calendars set up for this purpose (see
// CustomCalendarModal) — each row edited or cancelled individually via
// /api/custom-calendar/entries/[id], which handles the underlying
// cancel-and-recreate for an auto-charging period. Hidden entirely when
// there's nothing to show, so this stays invisible for the common case
// (a plain flat recurring schedule, no custom calendar at all).
export default function CustomCalendarPanel({ ownerType, ownerId, purpose, refreshKey }: Props) {
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const param = ownerType === 'student' ? `studentId=${ownerId}` : `donorId=${ownerId}`
    const res = await fetch(`/api/custom-calendar?${param}`)
    const json = await res.json().catch(() => [])
    if (Array.isArray(json)) {
      setCalendars(json.filter((c: Calendar) => c.purpose === purpose && c.status === 'active'))
    }
    setLoading(false)
  }, [ownerType, ownerId, purpose])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount/refresh
  useEffect(() => { load() }, [load, refreshKey])

  function startEdit(entry: Entry) {
    setEditingId(entry.id)
    setEditAmount(String(entry.amount))
    setEditDate(entry.period_date)
    setError('')
  }

  async function saveEdit(entryId: string) {
    setBusyId(entryId)
    setError('')
    try {
      const res = await fetch(`/api/custom-calendar/entries/${entryId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(editAmount), periodDate: editDate }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update.')
      setEditingId(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update.')
    } finally {
      setBusyId(null)
    }
  }

  async function cancelEntry(entryId: string) {
    if (!confirm('Cancel this period? If it auto-charges, that charge is stopped.')) return
    setBusyId(entryId)
    setError('')
    try {
      const res = await fetch(`/api/custom-calendar/entries/${entryId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to cancel.')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel.')
    } finally {
      setBusyId(null)
    }
  }

  async function cancelCalendar(calendarId: string) {
    if (!confirm('Cancel this entire custom calendar? Every period still pending (not yet charged) is stopped.')) return
    setBusyId(calendarId)
    setError('')
    try {
      const res = await fetch(`/api/custom-calendar/${calendarId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to cancel.')
      if (json.warning) setError(json.warning)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading || !calendars.length) return null

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-amber-600">{error}</p>}
      {calendars.map(cal => {
        const entries = (cal.custom_payment_calendar_entries || [])
          .filter(e => e.status !== 'cancelled')
          .sort((a, b) => a.period_date < b.period_date ? -1 : 1)
        if (!entries.length) return null
        const total = entries.reduce((s, e) => s + Number(e.amount), 0)
        return (
          <div key={cal.id} className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
              <span className="text-xs font-medium text-slate-600">
                Custom calendar — {cal.mode === 'auto_charge' ? 'auto-charging' : 'planning only'} · {formatCurrency(total)} total
              </span>
              <button onClick={() => cancelCalendar(cal.id)} disabled={busyId === cal.id}
                className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50">
                Cancel calendar
              </button>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-b border-slate-50 last:border-b-0">
                    {editingId === e.id ? (
                      <>
                        <td className="px-3 py-1.5">
                          <input type="date" value={editDate} onChange={ev => setEditDate(ev.target.value)}
                            className="border border-slate-200 rounded px-2 py-1 text-sm" />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <input type="number" step="0.01" min="0" value={editAmount} onChange={ev => setEditAmount(ev.target.value)}
                            className="w-24 border border-slate-200 rounded px-2 py-1 text-sm text-right" />
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <button onClick={() => saveEdit(e.id)} disabled={busyId === e.id} className="text-green-600 hover:text-green-700 mr-2">
                            {busyId === e.id ? <Loader2 size={14} className="animate-spin inline" /> : <Check size={14} className="inline" />}
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600"><X size={14} className="inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-1.5 text-slate-700">{new Date(`${e.period_date}T00:00:00`).toLocaleDateString()}</td>
                        <td className="px-3 py-1.5 text-right text-slate-900 font-medium">{formatCurrency(Number(e.amount))}</td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium mr-2 ${STATUS_META[e.status].badge}`}>
                            {STATUS_META[e.status].label}
                          </span>
                          <button onClick={() => startEdit(e)} className="text-slate-300 hover:text-blue-600 mr-1.5"><Pencil size={13} className="inline" /></button>
                          <button onClick={() => cancelEntry(e.id)} disabled={busyId === e.id} className="text-slate-300 hover:text-red-600"><Trash2 size={13} className="inline" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
