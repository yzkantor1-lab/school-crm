'use client'

import { useState } from 'react'
import { X, Loader2, Check, AlertCircle, Ban, ArrowRight, Pencil, FlagTriangleRight } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

type ScheduleSummary = {
  id: string
  purpose: string
  amount: number
  interval_type: string
  interval_count: number
}

type Choice = 'stop' | 'keep' | 'change' | 'finish'
type RowState = {
  choice: Choice
  newAmount: string
  remainingBalance: string
  paymentsProcessed: number | null
  loadingProcessed: boolean
  status: 'idle' | 'saving' | 'done' | 'error'
  error?: string
}

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
    Object.fromEntries(schedules.map(s => [s.id, {
      choice: 'stop' as Choice, newAmount: String(s.amount), remainingBalance: '',
      paymentsProcessed: null, loadingProcessed: false, status: 'idle' as const,
    }]))
  )
  const [submitting, setSubmitting] = useState(false)
  const [allDone, setAllDone] = useState(false)

  function setRow(id: string, patch: Partial<RowState>) {
    setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }))
  }

  // "Finish plan": needs to know how many payments Sola has already run
  // before it can compute where the cap should land — fetched lazily, only
  // the first time a schedule is switched to this choice.
  async function chooseFinish(s: ScheduleSummary) {
    setRow(s.id, { choice: 'finish', status: 'idle' })
    if (rows[s.id].paymentsProcessed != null || rows[s.id].loadingProcessed) return
    setRow(s.id, { loadingProcessed: true })
    try {
      const res = await fetch(`/api/sola/schedule?id=${s.id}`)
      const json = await res.json()
      setRow(s.id, { paymentsProcessed: res.ok ? (json.paymentsProcessed ?? 0) : 0, loadingProcessed: false })
    } catch {
      setRow(s.id, { paymentsProcessed: 0, loadingProcessed: false })
    }
  }

  function remainingPaymentsFor(s: ScheduleSummary, row: RowState): number {
    const balance = Number(row.remainingBalance)
    if (!balance || balance <= 0 || !s.amount) return 0
    return Math.ceil(balance / s.amount)
  }

  async function submit() {
    for (const s of schedules) {
      const row = rows[s.id]
      if (row.choice === 'keep') { setRow(s.id, { status: 'done' }); continue }
      if (row.choice === 'change' && (!row.newAmount || Number(row.newAmount) <= 0)) {
        setRow(s.id, { status: 'error', error: 'Enter a valid amount.' })
        return
      }
      if (row.choice === 'finish' && remainingPaymentsFor(s, row) <= 0) {
        setRow(s.id, { status: 'error', error: 'Enter the remaining balance still owed.' })
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
        } else if (row.choice === 'finish') {
          const totalPayments = (row.paymentsProcessed ?? 0) + remainingPaymentsFor(s, row)
          const res = await fetch('/api/sola/schedule', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: s.id, totalPayments }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(json.error || 'Failed to set the payoff point.')
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
                <div className="grid grid-cols-2 gap-1.5">
                  <button disabled={submitting} onClick={() => setRow(s.id, { choice: 'stop', status: 'idle' })}
                    className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${row.choice === 'stop' ? 'bg-red-50 border-red-300 text-red-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    <Ban size={12} /> Stop now
                  </button>
                  <button disabled={submitting} onClick={() => setRow(s.id, { choice: 'keep', status: 'idle' })}
                    className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${row.choice === 'keep' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    <ArrowRight size={12} /> Leave running
                  </button>
                  <button disabled={submitting} onClick={() => chooseFinish(s)}
                    className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${row.choice === 'finish' ? 'bg-green-50 border-green-300 text-green-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    <FlagTriangleRight size={12} /> Finish payment plan
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
                {row.choice === 'finish' && (
                  <div className="space-y-1">
                    <input type="number" step="0.01" min="0" disabled={submitting || row.loadingProcessed} value={row.remainingBalance}
                      onChange={e => setRow(s.id, { remainingBalance: e.target.value })}
                      placeholder="Remaining balance still owed"
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    {row.loadingProcessed ? (
                      <p className="text-xs text-slate-400">Checking payments so far…</p>
                    ) : remainingPaymentsFor(s, row) > 0 ? (
                      <p className="text-xs text-green-700">
                        {remainingPaymentsFor(s, row)} more payment{remainingPaymentsFor(s, row) === 1 ? '' : 's'} of {formatCurrency(s.amount)}
                        {' '}(≈{formatCurrency(remainingPaymentsFor(s, row) * s.amount)}), then it stops automatically on its own — no need to remember to come back.
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400">Enter what&apos;s still owed to see how many payments are left.</p>
                    )}
                  </div>
                )}
                {row.status === 'done' && (
                  <p className="flex items-center gap-1 text-xs text-green-700">
                    <Check size={12} /> {row.choice === 'stop' ? 'Stopped.' : row.choice === 'keep' ? 'Left running.' : row.choice === 'finish' ? 'Payoff point set — will stop on its own after that.' : 'Amount updated.'}
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
