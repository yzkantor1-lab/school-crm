'use client'

import { useState } from 'react'
import { X, Loader2, Check, AlertCircle, Plus, Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

type SavedMethod = { id: string; label: string }
type Row = { id: string; periodDate: string; amount: string }

type Props = {
  onClose: () => void
  onCreated: () => void
  ownerType: 'student' | 'donor'
  ownerId: string
  purpose: 'tuition' | 'building_fund' | 'phone_charge' | 'donation'
  purposeLabel: string
  remainingBalance: number
  yearEndDate: string | null
  savedMethods: SavedMethod[]
  // The currently active flat recurring schedule for this purpose, if any —
  // auto-charge mode stops it before creating the per-period ones so the
  // family isn't billed by both at once.
  cancelScheduleId?: string
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

function newRow(periodDate: string, amount: string): Row {
  return { id: `${periodDate}-${Math.random().toString(36).slice(2, 8)}`, periodDate, amount }
}

// Sola's recurring API has no "different amount each occurrence" primitive
// — a flat schedule always charges the same amount every cycle. This lets
// staff fill in whatever they want for each individual period instead: an
// even split of a balance as a starting point, but every row is its own
// number, freely edited/added/removed. Auto-charge mode turns each row into
// its own one-time Sola schedule (see app/api/custom-calendar); planning
// mode just saves the grid as a reference — no Sola involvement at all.
export default function CustomCalendarModal({
  onClose, onCreated, ownerType, ownerId, purpose, purposeLabel, remainingBalance, yearEndDate, savedMethods, cancelScheduleId,
}: Props) {
  const [mode, setMode] = useState<'auto_charge' | 'planning_only'>('auto_charge')
  const [paymentMethodId, setPaymentMethodId] = useState(savedMethods[0]?.id ?? '')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [monthsToFill, setMonthsToFill] = useState('6')
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function fillEvenly() {
    const n = Math.max(1, parseInt(monthsToFill) || 1)
    const perMonth = (remainingBalance / n).toFixed(2)
    setRows(Array.from({ length: n }, (_, i) => newRow(addMonths(startDate, i), perMonth)))
  }
  function fillToYearEnd() {
    if (!yearEndDate) return
    const months: string[] = []
    let cur = startDate
    let iterations = 0
    while (cur <= yearEndDate && iterations < 60) {
      months.push(cur)
      cur = addMonths(cur, 1)
      iterations++
    }
    const perMonth = (remainingBalance / Math.max(1, months.length)).toFixed(2)
    setRows(months.map(m => newRow(m, perMonth)))
    setMonthsToFill(String(months.length))
  }

  function updateRow(id: string, field: 'periodDate' | 'amount', value: string) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
  }
  function removeRow(id: string) {
    setRows(rs => rs.filter(r => r.id !== id))
  }
  function addRow() {
    const last = rows[rows.length - 1]
    setRows(rs => [...rs, newRow(last ? addMonths(last.periodDate, 1) : startDate, '0.00')])
  }

  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)

  async function confirm() {
    setResult(null)
    if (!rows.length) { setResult({ type: 'error', msg: 'Add at least one period.' }); return }
    if (rows.some(r => !r.periodDate || !(parseFloat(r.amount) > 0))) {
      setResult({ type: 'error', msg: 'Every period needs a date and a positive amount.' }); return
    }
    if (mode === 'auto_charge' && !paymentMethodId) {
      setResult({ type: 'error', msg: 'Pick a payment method for auto-charging.' }); return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/custom-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: ownerType, id: ownerId, purpose, mode,
          paymentMethodId: mode === 'auto_charge' ? paymentMethodId : undefined,
          cancelScheduleId: mode === 'auto_charge' ? cancelScheduleId : undefined,
          entries: rows.map(r => ({ periodDate: r.periodDate, amount: parseFloat(r.amount) })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create the calendar.')

      if (json.failed?.length) {
        setResult({
          type: 'error',
          msg: `Created ${json.scheduled} of ${rows.length} — ${json.failed.length} period(s) failed: ${json.failed.map((f: { periodDate: string; error: string }) => `${f.periodDate} (${f.error})`).join('; ')}`,
        })
      } else {
        setResult({ type: 'success', msg: mode === 'auto_charge' ? `${json.scheduled} period(s) scheduled to auto-charge.` : 'Calendar saved.' })
      }
      onCreated()
    } catch (err) {
      setResult({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to create the calendar.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Custom {purposeLabel} Calendar</h2>
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

        <p className="text-sm text-slate-500">
          Fill in whatever amount each period should be — an even split is just a starting point, edit any row,
          or add/remove periods entirely.
        </p>

        <div className="flex gap-2">
          <button type="button" onClick={() => setMode('auto_charge')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === 'auto_charge' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
            Auto-charge each period
          </button>
          <button type="button" onClick={() => setMode('planning_only')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === 'planning_only' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
            Planning only (I&apos;ll charge/record each myself)
          </button>
        </div>

        {mode === 'auto_charge' && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Payment method</label>
            {savedMethods.length ? (
              <select value={paymentMethodId} onChange={e => setPaymentMethodId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {savedMethods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            ) : (
              <p className="text-xs text-amber-600">No saved payment method on file — set up a recurring or one-time charge first to save one, then come back here.</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Start date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Months</label>
            <input type="number" min="1" value={monthsToFill} onChange={e => setMonthsToFill(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex items-end gap-2">
            <button type="button" onClick={fillEvenly}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50 transition-colors">
              Fill {formatCurrency(remainingBalance)} evenly
            </button>
          </div>
        </div>
        {yearEndDate && (
          <button type="button" onClick={fillToYearEnd}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 underline">
            Or fill evenly through year end ({new Date(`${yearEndDate}T00:00:00`).toLocaleDateString()})
          </button>
        )}

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-3 py-2 text-slate-500 font-medium">Period</th>
                <th className="text-right px-3 py-2 text-slate-500 font-medium">Amount</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-3 py-1.5">
                    <input type="date" value={r.periodDate} onChange={e => updateRow(r.id, 'periodDate', e.target.value)}
                      className="w-full border border-slate-200 rounded px-2 py-1 text-sm" />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" step="0.01" min="0" value={r.amount} onChange={e => updateRow(r.id, 'amount', e.target.value)}
                      className="w-full border border-slate-200 rounded px-2 py-1 text-sm text-right" />
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => removeRow(r.id)} className="text-slate-300 hover:text-red-600"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400 text-sm">No periods yet — use the fill buttons above, or add one.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-600">
                  <button onClick={addRow} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                    <Plus size={13} /> Add period
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        {Math.abs(total - remainingBalance) > 0.01 && rows.length > 0 && (
          <p className="text-xs text-amber-600">Total ({formatCurrency(total)}) doesn&apos;t match the {formatCurrency(remainingBalance)} balance — that&apos;s fine if intentional.</p>
        )}

        <button
          onClick={confirm}
          disabled={saving || !rows.length}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {saving ? 'Saving…' : mode === 'auto_charge' ? 'Create & Start Auto-Charging' : 'Save Calendar'}
        </button>
      </div>
    </div>
  )
}
