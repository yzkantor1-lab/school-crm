'use client'

import { useRef, useState } from 'react'
import { X, Loader2, Check, AlertCircle, ChevronLeft, Ban, Pencil, CreditCard, Calculator, CalendarRange } from 'lucide-react'
import PaymentFields, { type PaymentFieldsHandle } from './PaymentFields'
import { formatCurrency } from '@/lib/currency'

type ScheduleSummary = {
  id: string
  purpose: string
  amount: number
  interval_type: string
  interval_count: number
  total_payments: number | null
  payment_method_id: string | null
}
type SavedMethod = { id: string; label: string }

type Props = {
  onClose: () => void
  type: 'student' | 'donor'
  // Every currently-active schedule for this student/donor — if there's
  // more than one (e.g. Tuition + Phone Charge) and the caller didn't
  // already say which one via initialScheduleId, a picker step asks first
  // rather than guessing.
  schedules: ScheduleSummary[]
  savedMethods: SavedMethod[]
  initialScheduleId?: string
  onChanged?: () => void
  // Opens the caller's own Recalculate flow for the active schedule — the
  // caller owns the "what's actually still owed" math (it varies by
  // purpose and needs data this generic modal doesn't have), so this modal
  // just closes itself and hands back which schedule was picked. Omit to
  // hide the Recalculate option entirely (e.g. donor recurring donations,
  // where "balance owed" isn't a concept).
  onRecalculate?: (schedule: ScheduleSummary) => void
  // Same idea as onRecalculate — opens the caller's custom per-period
  // calendar flow. customCalendarPurposes restricts which purposes show the
  // option at all (e.g. just 'tuition' while the rest are still being
  // built out); omit onCustomCalendar entirely to hide it everywhere.
  onCustomCalendar?: (schedule: ScheduleSummary) => void
  customCalendarPurposes?: string[]
}

const INTERVALS = [
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
]
const PURPOSE_LABEL: Record<string, string> = {
  tuition: 'Tuition', building_fund: 'Building Fund', phone_charge: 'Phone Charge', donation: 'Donation',
}

function cadenceLabel(s: ScheduleSummary) {
  const amt = formatCurrency(s.amount)
  return s.interval_count === 1 ? `${amt} / ${s.interval_type}` : `${amt} every ${s.interval_count} ${s.interval_type}s`
}

export default function ManageRecurringModal({
  onClose, type, schedules, savedMethods, initialScheduleId, onChanged, onRecalculate, onCustomCalendar, customCalendarPurposes,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(
    initialScheduleId ?? (schedules.length === 1 ? schedules[0].id : null)
  )
  const [view, setView] = useState<'picker' | 'detail' | 'edit' | 'card'>(activeId ? 'detail' : 'picker')
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const active = schedules.find(s => s.id === activeId) ?? null

  // ── Edit (amount/cadence/payment count) ─────────────────────────────────
  const [amount, setAmount] = useState('')
  const [intervalType, setIntervalType] = useState<'week' | 'month' | 'year'>('month')
  const [intervalCount, setIntervalCount] = useState('1')
  const [ongoing, setOngoing] = useState(true)
  const [totalPayments, setTotalPayments] = useState('12')

  function openEdit() {
    if (!active) return
    setAmount(String(active.amount))
    setIntervalType((active.interval_type as 'week' | 'month' | 'year') || 'month')
    setIntervalCount(String(active.interval_count || 1))
    setOngoing(active.total_payments == null)
    setTotalPayments(String(active.total_payments ?? 12))
    setResult(null)
    setView('edit')
  }

  async function saveEdit() {
    if (!active) return
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setResult({ type: 'error', msg: 'Enter a valid amount.' }); return }
    if (!ongoing && !(parseInt(totalPayments) > 0)) { setResult({ type: 'error', msg: 'Enter a number of payments.' }); return }

    setBusy(true); setResult(null)
    try {
      const res = await fetch('/api/sola/schedule', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: active.id, amount: amt, intervalType, intervalCount: parseInt(intervalCount) || 1,
          totalPayments: ongoing ? null : parseInt(totalPayments),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update.')
      setResult({ type: 'success', msg: 'Updated.' })
      onChanged?.()
      setView('detail')
    } catch (err) {
      setResult({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to update.' })
    } finally {
      setBusy(false)
    }
  }

  // ── Update payment method ────────────────────────────────────────────────
  const [methodChoice, setMethodChoice] = useState<string>(savedMethods[0]?.id ?? 'new')
  const [newMethodType, setNewMethodType] = useState<'card' | 'ach'>('card')
  const [saveMethod, setSaveMethod] = useState(true)
  const fieldsRef = useRef<PaymentFieldsHandle>(null)

  function openCardUpdate() {
    setMethodChoice(savedMethods.find(m => m.id === active?.payment_method_id)?.id ?? savedMethods[0]?.id ?? 'new')
    setResult(null)
    setView('card')
  }

  async function saveCard() {
    if (!active) return
    setBusy(true); setResult(null)
    try {
      const body: Record<string, unknown> = { id: active.id }
      if (methodChoice === 'new') {
        const token = await fieldsRef.current?.getToken()
        if (!token) throw new Error('Enter payment details.')
        body.newPaymentMethod = token
        body.save = saveMethod
      } else {
        body.paymentMethodId = methodChoice
      }
      const res = await fetch('/api/sola/schedule', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update payment method.')
      setResult({ type: 'success', msg: 'Payment method updated.' })
      onChanged?.()
      setView('detail')
    } catch (err) {
      setResult({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to update payment method.' })
    } finally {
      setBusy(false)
    }
  }

  // ── Stop ─────────────────────────────────────────────────────────────────
  async function stop() {
    if (!active) return
    const label = PURPOSE_LABEL[active.purpose] ?? active.purpose
    if (!confirm(`Stop the recurring ${label}? This cancels the schedule with Sola — no further charges will go through until it's set up again.`)) return
    setBusy(true); setResult(null)
    try {
      const res = await fetch(`/api/sola/schedule?id=${active.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Failed to stop the recurring charge.')
      onChanged?.()
      onClose()
    } catch (err) {
      setResult({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to stop.' })
      setBusy(false)
    }
  }

  const title = view === 'picker' ? 'Recurring Charges'
    : view === 'edit' ? `Edit ${active ? PURPOSE_LABEL[active.purpose] ?? active.purpose : ''}`
    : view === 'card' ? `Update Payment Method`
    : active ? `${PURPOSE_LABEL[active.purpose] ?? active.purpose} — Recurring` : 'Recurring'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {view !== 'picker' && (view === 'edit' || view === 'card' ? (
              <button onClick={() => setView('detail')} className="text-slate-400 hover:text-slate-600"><ChevronLeft size={18} /></button>
            ) : schedules.length > 1 && !initialScheduleId ? (
              <button onClick={() => { setActiveId(null); setView('picker') }} className="text-slate-400 hover:text-slate-600"><ChevronLeft size={18} /></button>
            ) : null)}
            <h2 className="font-semibold text-slate-900">{title}</h2>
          </div>
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

        {view === 'picker' && (
          <div className="space-y-1.5">
            <p className="text-xs text-slate-400">This {type} has more than one active recurring charge — which one?</p>
            {schedules.map(s => (
              <button key={s.id} onClick={() => { setActiveId(s.id); setView('detail') }}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-left transition-colors">
                <span className="text-sm font-medium text-slate-800">{PURPOSE_LABEL[s.purpose] ?? s.purpose}</span>
                <span className="text-sm text-slate-500">{cadenceLabel(s)}</span>
              </button>
            ))}
          </div>
        )}

        {view === 'detail' && active && (
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-4 space-y-1">
              <p className="text-sm text-slate-700">{cadenceLabel(active)}</p>
              {active.total_payments != null && <p className="text-xs text-slate-400">Fixed plan — {active.total_payments} payments total</p>}
              <p className="text-xs text-slate-400">
                {savedMethods.find(m => m.id === active.payment_method_id)?.label ?? 'Card/bank on file'}
              </p>
            </div>
            {(() => {
              const showCustomCalendar = !!onCustomCalendar && (!customCalendarPurposes || customCalendarPurposes.includes(active.purpose))
              const count = 3 + (onRecalculate ? 1 : 0) + (showCustomCalendar ? 1 : 0)
              return (
                <div className={`grid gap-2 ${count >= 5 ? 'grid-cols-3 sm:grid-cols-5' : count === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                  <button onClick={openEdit} className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-xs font-medium text-slate-700">
                    <Pencil size={15} /> Edit
                  </button>
                  {onRecalculate && (
                    <button onClick={() => { onRecalculate(active); onClose() }}
                      className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-xs font-medium text-slate-700">
                      <Calculator size={15} /> Recalculate
                    </button>
                  )}
                  {showCustomCalendar && (
                    <button onClick={() => { onCustomCalendar!(active); onClose() }}
                      className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-xs font-medium text-slate-700">
                      <CalendarRange size={15} /> Custom Calendar
                    </button>
                  )}
                  <button onClick={openCardUpdate} className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-xs font-medium text-slate-700">
                    <CreditCard size={15} /> Update Card
                  </button>
                  <button onClick={stop} disabled={busy} className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border border-red-200 hover:bg-red-50 text-xs font-medium text-red-600 disabled:opacity-50">
                    <Ban size={15} /> Stop
                  </button>
                </div>
              )
            })()}
          </div>
        )}

        {view === 'edit' && active && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Amount per payment</label>
              <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Every</label>
                <input type="number" min="1" value={intervalCount} onChange={e => setIntervalCount(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Frequency</label>
                <select value={intervalType} onChange={e => setIntervalType(e.target.value as 'week' | 'month' | 'year')}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}(s)</option>)}
                </select>
              </div>
            </div>
            <div>
              <div className="flex gap-2 mb-2">
                <button type="button" onClick={() => setOngoing(true)}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${ongoing ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                  Ongoing (recurring)
                </button>
                <button type="button" onClick={() => setOngoing(false)}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${!ongoing ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                  Fixed # of payments
                </button>
              </div>
              {!ongoing && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Number of payments</label>
                  <input type="number" min="1" value={totalPayments} onChange={e => setTotalPayments(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
            </div>
            <button onClick={saveEdit} disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
              {busy && <Loader2 size={15} className="animate-spin" />} {busy ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}

        {view === 'card' && active && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Payment Method</label>
              <select value={methodChoice} onChange={e => setMethodChoice(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {savedMethods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                <option value="new">+ New card or bank account</option>
              </select>
            </div>
            {methodChoice === 'new' && (
              <div className="space-y-3 border-t border-slate-100 pt-3">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setNewMethodType('card')}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${newMethodType === 'card' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                    Card
                  </button>
                  <button type="button" onClick={() => setNewMethodType('ach')}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${newMethodType === 'ach' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                    Bank Account (ACH)
                  </button>
                </div>
                <PaymentFields ref={fieldsRef} method={newMethodType} />
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  <input type="checkbox" checked={saveMethod} onChange={e => setSaveMethod(e.target.checked)} />
                  Save this payment method for future charges
                </label>
              </div>
            )}
            <button onClick={saveCard} disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
              {busy && <Loader2 size={15} className="animate-spin" />} {busy ? 'Saving…' : 'Update Payment Method'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
