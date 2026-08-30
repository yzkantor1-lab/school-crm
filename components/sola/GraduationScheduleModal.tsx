'use client'

import { useState } from 'react'
import { X, Loader2, Check, AlertCircle, Ban, ArrowRight, Pencil } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

type ScheduleSummary = {
  id: string
  purpose: string
  amount: number
  interval_type: string
  interval_count: number
}

type Choice = 'stop' | 'keep' | 'change'
type RowState = { choice: Choice; newAmount: string; status: 'idle' | 'saving' | 'done' | 'error'; error?: string }

const PURPOSE_LABEL: Record<string, string> = {
  tuition: 'Tuition', building_fund: 'Building Fund', phone_charge: 'Phone Charge', donation: 'Donation',
}

function cadenceLabel(s: ScheduleSummary) {
  const amt = formatCurrency(s.amount)
  return s.interval_count === 1 ? `${amt} / ${s.interval_type}` : `${amt} every ${s.interval_count} ${s.interval_type}s`
}

// Shown when a student's status is saved as 'graduated' and they still have
// active recurring schedules — graduating doesn't stop billing on its own,
// so this is the one moment to explicitly decide, per schedule, whether to
// stop it, leave it running (e.g. a building fund pledge that continues), or
// adjust the amount (e.g. tapering down a remaining balance) instead of
// letting it keep charging the graduated rate silently.
export default function GraduationScheduleModal({ studentName, schedules, onClose, onDone }: {
  studentName: string
  schedules: ScheduleSummary[]
  onClose: () => void
  onDone: () => void
}) {
  const [rows, setRows] = useState<Record<string, RowState>>(
    Object.fromEntries(schedules.map(s => [s.id, { choice: 'stop' as Choice, newAmount: String(s.amount), status: 'idle' as const }]))
  )
  const [submitting, setSubmitting] = useState(false)
  const [allDone, setAllDone] = useState(false)

  function setRow(id: string, patch: Partial<RowState>) {
    setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }))
  }

  async function submit() {
    for (const s of schedules) {
      const row = rows[s.id]
      if (row.choice === 'keep') { setRow(s.id, { status: 'done' }); continue }
      if (row.choice === 'change' && (!row.newAmount || Number(row.newAmount) <= 0)) {
        setRow(s.id, { status: 'error', error: 'Enter a valid amount.' })
        return
      }
    }
    setSubmitting(true)
    for (const s of schedules) {
      const row = rows[s.id]
      if (row.choice === 'keep') continue
      setRow(s.id, { status: 'saving' })
      try {
        if (row.choice === 'stop') {
          const res = await fetch(`/api/sola/schedule?id=${s.id}`, { method: 'DELETE' })
          const json = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(json.error || 'Failed to stop.')
        } else {
          const res = await fetch('/api/sola/schedule', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: s.id, amount: Number(row.newAmount) }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(json.error || 'Failed to update.')
        }
        setRow(s.id, { status: 'done' })
      } catch (err) {
        setRow(s.id, { status: 'error', error: err instanceof Error ? err.message : 'Failed.' })
      }
    }
    setSubmitting(false)
    setAllDone(true)
  }

  const hasErrors = Object.values(rows).some(r => r.status === 'error')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={submitting ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Graduating {studentName}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {schedules.length === 1 ? 'This student has an active recurring charge.' : `This student has ${schedules.length} active recurring charges.`} What should happen to {schedules.length === 1 ? 'it' : 'each one'}?
            </p>
          </div>
          {!submitting && <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>}
        </div>

        <div className="space-y-3">
          {schedules.map(s => {
            const row = rows[s.id]
            return (
              <div key={s.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-800">{PURPOSE_LABEL[s.purpose] ?? s.purpose}</span>
                  <span className="text-xs text-slate-500">{cadenceLabel(s)}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button disabled={submitting} onClick={() => setRow(s.id, { choice: 'stop', status: 'idle' })}
                    className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${row.choice === 'stop' ? 'bg-red-50 border-red-300 text-red-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    <Ban size={12} /> Stop
                  </button>
                  <button disabled={submitting} onClick={() => setRow(s.id, { choice: 'keep', status: 'idle' })}
                    className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${row.choice === 'keep' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    <ArrowRight size={12} /> Leave running
                  </button>
                  <button disabled={submitting} onClick={() => setRow(s.id, { choice: 'change', status: 'idle' })}
                    className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${row.choice === 'change' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    <Pencil size={12} /> Change amount
                  </button>
                </div>
                {row.choice === 'change' && (
                  <input type="number" step="0.01" min="0" disabled={submitting} value={row.newAmount}
                    onChange={e => setRow(s.id, { newAmount: e.target.value })}
                    placeholder="New amount per payment"
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
                {row.status === 'done' && (
                  <p className="flex items-center gap-1 text-xs text-green-700">
                    <Check size={12} /> {row.choice === 'stop' ? 'Stopped.' : row.choice === 'keep' ? 'Left running.' : 'Amount updated.'}
                  </p>
                )}
                {row.status === 'error' && (
                  <p className="flex items-center gap-1 text-xs text-red-600"><AlertCircle size={12} /> {row.error}</p>
                )}
              </div>
            )
          })}
        </div>

        {allDone ? (
          <button onClick={onDone}
            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            {hasErrors ? 'Close (some need attention)' : 'Done'}
          </button>
        ) : (
          <button onClick={submit} disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            {submitting && <Loader2 size={15} className="animate-spin" />} {submitting ? 'Applying…' : 'Confirm'}
          </button>
        )}
      </div>
    </div>
  )
}
