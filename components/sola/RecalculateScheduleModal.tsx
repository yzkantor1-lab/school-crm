'use client'

import { useEffect, useState } from 'react'
import { X, Loader2, Check, AlertCircle } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

type ScheduleInfo = {
  id: string
  amount: number
  interval_type: string
  interval_count: number
  total_payments: number | null
  payment_method_id: string | null
  start_date: string
}

type Props = {
  onClose: () => void
  onDone: () => void
  studentId: string
  purpose: 'tuition' | 'building_fund' | 'phone_charge'
  purposeLabel: string
  schedule: ScheduleInfo
  remainingBalance: number
}

function cadenceLabel(intervalType: string, intervalCount: number) {
  if (intervalCount === 1) return `every ${intervalType}`
  return `every ${intervalCount} ${intervalType}s`
}

// Replaces an active schedule with a new one sized to divide a target amount
// evenly across however many payments are left — the original use case was a
// manual payment landing mid-plan and the schedule's math no longer adding
// up to the real balance, but staff can open this anytime (e.g. a family
// wants to resume in a later month, or gave an amount that hasn't been
// recorded yet) and type in whatever amount/payments-left actually applies —
// the incoming balance is only a starting suggestion, not enforced.
// Sola has no "just change the remaining amount" API, so this cancels the
// existing schedule and creates a new one on the same card/cadence — staff
// confirms the numbers first rather than this happening automatically,
// since it's a real change to live billing.
export default function RecalculateScheduleModal({ onClose, onDone, studentId, purpose, purposeLabel, schedule, remainingBalance }: Props) {
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [statusError, setStatusError] = useState('')
  const [balance, setBalance] = useState(remainingBalance.toFixed(2))
  const [remainingPayments, setRemainingPayments] = useState('')
  const [amount, setAmount] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    async function loadStatus() {
      setLoadingStatus(true)
      setStatusError('')
      try {
        const res = await fetch(`/api/sola/schedule?id=${schedule.id}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to check schedule status with Sola.')
        const total = json.totalPayments ?? schedule.total_payments ?? 0
        const processed = json.paymentsProcessed ?? 0
        const remaining = Math.max(1, total - processed)
        setRemainingPayments(String(remaining))
        setAmount((remainingBalance / remaining).toFixed(2))
        if (json.nextScheduledRunTime) setStartDate(String(json.nextScheduledRunTime).slice(0, 10))
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : 'Failed to check schedule status with Sola.')
      }
      setLoadingStatus(false)
    }
    loadStatus()
  }, [schedule.id, schedule.total_payments, remainingBalance])

  function recompute(nextBalance: string, nextRemainingPayments: string) {
    const b = parseFloat(nextBalance)
    const n = parseInt(nextRemainingPayments)
    if (n > 0 && b >= 0) setAmount((b / n).toFixed(2))
  }
  function onBalanceChange(v: string) {
    setBalance(v)
    recompute(v, remainingPayments)
  }
  function recomputeAmount(nextRemainingPayments: string) {
    recompute(balance, nextRemainingPayments)
  }

  async function confirm() {
    setResult(null)
    if (!schedule.payment_method_id) {
      setResult({ type: 'error', msg: "This schedule's payment method was never saved for reuse — cancel it and set up a new recurring payment with fresh card details instead." })
      return
    }
    const amt = parseFloat(amount)
    const n = parseInt(remainingPayments)
    if (!amt || amt <= 0) { setResult({ type: 'error', msg: 'Enter a valid amount.' }); return }
    if (!(n > 0)) { setResult({ type: 'error', msg: 'Enter a valid number of remaining payments.' }); return }

    setSaving(true)
    try {
      const del = await fetch(`/api/sola/schedule?id=${schedule.id}`, { method: 'DELETE' })
      if (!del.ok) {
        const j = await del.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to cancel the old schedule — nothing was changed.')
      }
      const res = await fetch('/api/sola/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'student', id: studentId, amount: amt, purpose,
          intervalType: schedule.interval_type, intervalCount: schedule.interval_count,
          totalPayments: n, startDate, paymentMethodId: schedule.payment_method_id,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(
          `Old schedule was cancelled, but creating the new one failed: ${json.error || 'unknown error'}. ` +
          `No recurring schedule is currently active for ${purposeLabel.toLowerCase()} — set one up again.`
        )
      }

      setResult({
        type: 'success',
        msg: `${json.isTest ? '[TEST MODE] ' : ''}Schedule replaced — ${formatCurrency(amt)} ${cadenceLabel(schedule.interval_type, schedule.interval_count)}, ${n} payment${n === 1 ? '' : 's'} remaining.`,
      })
      onDone()
    } catch (err) {
      setResult({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to replace the schedule.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Recalculate {purposeLabel} Schedule</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {result && (
          <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
            result.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {result.type === 'success' ? <Check size={14} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />}
            {result.msg}
          </div>
        )}

        {loadingStatus ? (
          <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking schedule status with Sola…</p>
        ) : statusError ? (
          <p className="text-sm text-red-600">{statusError}</p>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              This cancels the current {formatCurrency(schedule.amount)} {cadenceLabel(schedule.interval_type, schedule.interval_count)} schedule
              and starts a new one — same card, same cadence — for whatever amount and start date you set below.
              The remaining balance is only a starting suggestion; change it if it doesn&apos;t match what&apos;s actually still owed.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Remaining balance</label>
              <input type="number" step="0.01" min="0" value={balance} onChange={e => onBalanceChange(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Remaining payments</label>
                <input type="number" min="1" value={remainingPayments}
                  onChange={e => { setRemainingPayments(e.target.value); recomputeAmount(e.target.value) }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">New amount per payment</label>
                <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Resume / next payment date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {!schedule.payment_method_id && (
              <p className="text-xs text-amber-600">This schedule&apos;s payment method wasn&apos;t saved for reuse — cancel it and set up a new recurring payment instead.</p>
            )}

            <button
              onClick={confirm}
              disabled={saving || !schedule.payment_method_id}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {saving ? 'Replacing…' : 'Cancel Old & Start New Schedule'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
