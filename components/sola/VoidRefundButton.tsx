'use client'

import { useState } from 'react'
import { Undo2, X, Loader2, AlertCircle, Check, AlertTriangle } from 'lucide-react'

// Flip to false (or just delete this const and the badge block below) once
// this has been confirmed against a real live charge — see the red warning
// badge next to the button, added 2026-09-17 per the user's request right
// after this feature shipped, before it had ever been exercised for real.
const UNVERIFIED_LIVE = true

type Props = {
  recordType: 'tuition_payment' | 'donation'
  recordId: string
  amount: number
  // Full hover class matching the surrounding row's icon color, e.g.
  // "hover:text-blue-600" — passed whole (not composed from a color name)
  // so Tailwind's static analysis actually picks it up at build time.
  hoverClass: string
  onDone: () => void   // caller reloads its own data to reflect the now-zeroed record
}

// Row-level action for reversing an actual Sola/Cardknox charge — see
// app/api/sola/void-refund/route.ts for what this actually does and why it
// exists (the Adler incident, Sept 2026). Only rendered by callers when the
// record has a sola_transaction_id, since there's nothing to reverse otherwise.
export default function VoidRefundButton({ recordType, recordId, amount, hoverClass, onDone }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showCaveat, setShowCaveat] = useState(false)

  async function confirm() {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/sola/void-refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordType, recordId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to void or refund this charge.')
      setResult({
        ok: true,
        msg: json.action === 'voided'
          ? 'Voided — this had not settled yet, so no money ever moved.'
          : `Refunded $${Number(json.amount).toFixed(2)} — it will land back in their account within a few business days.`,
      })
      onDone()
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Failed to void or refund this charge.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <span className="relative inline-flex items-center">
        <button onClick={() => setOpen(true)} className={`p-1 text-slate-300 ${hoverClass} transition-colors`} title="Void or refund this Sola charge">
          <Undo2 size={13} />
        </button>
        {UNVERIFIED_LIVE && (
          <button
            onClick={() => setShowCaveat(v => !v)}
            title="Not yet confirmed against a real charge"
            className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 hover:bg-red-600 ring-2 ring-white"
          />
        )}
        {showCaveat && (
          <div className="absolute z-40 top-full right-0 mt-1 w-64 bg-white border border-red-200 rounded-lg shadow-lg p-3 text-xs text-slate-700">
            <div className="flex items-start gap-1.5">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
              <p>
                This hasn&rsquo;t been tried against a real live charge yet — verify it does what it says (voids or refunds correctly) before
                relying on it for a larger amount.
              </p>
            </div>
            <button onClick={() => setShowCaveat(false)} className="text-slate-400 hover:text-slate-600 mt-2">Dismiss</button>
          </div>
        )}
      </span>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/30" onClick={() => !loading && setOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 text-sm">Void or refund this charge?</h2>
              <button onClick={() => setOpen(false)} disabled={loading} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            {result ? (
              <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {result.ok ? <Check size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                {result.msg}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                This will contact Cardknox for the ${amount.toFixed(2)} charge. We&rsquo;ll try to void it first (no money moves) and only
                fall back to a full refund if it&rsquo;s already settled — you&rsquo;ll see which one actually happened.
              </p>
            )}

            <div className="flex justify-end gap-2">
              {result?.ok ? (
                <button onClick={() => setOpen(false)} className="bg-slate-100 text-slate-700 rounded-lg px-3 py-1.5 text-sm font-medium">Close</button>
              ) : (
                <>
                  <button onClick={() => setOpen(false)} disabled={loading} className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40">Cancel</button>
                  <button onClick={confirm} disabled={loading} className="bg-red-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40 flex items-center gap-1.5">
                    {loading && <Loader2 size={13} className="animate-spin" />} Void / Refund
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
