'use client'

import { useRef, useState } from 'react'
import { X, Loader2, Check, AlertCircle } from 'lucide-react'
import PaymentFields, { type PaymentFieldsHandle } from './PaymentFields'

type SavedMethod = { id: string; label: string }

type Props = {
  onClose: () => void
  type: 'student' | 'donor'
  id: string
  purposeOptions: { value: string; label: string }[]
  savedMethods: SavedMethod[]
  onCharged?: () => void
}

export default function ChargeModal({ onClose, type, id, purposeOptions, savedMethods, onCharged }: Props) {
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState(purposeOptions[0]?.value ?? '')
  const [methodChoice, setMethodChoice] = useState<string>(savedMethods[0]?.id ?? 'new')
  const [newMethodType, setNewMethodType] = useState<'card' | 'ach'>('card')
  const [saveMethod, setSaveMethod] = useState(true)
  const [charging, setCharging] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const fieldsRef = useRef<PaymentFieldsHandle>(null)

  async function charge() {
    setResult(null)
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setResult({ type: 'error', msg: 'Enter a valid amount.' }); return }

    setCharging(true)
    try {
      const body: Record<string, unknown> = { type, id, amount: amt, purpose }
      if (methodChoice === 'new') {
        const token = await fieldsRef.current?.getToken()
        if (!token) throw new Error('Enter payment details.')
        body.newPaymentMethod = token
        body.save = saveMethod
      } else {
        body.paymentMethodId = methodChoice
      }

      const res = await fetch('/api/sola/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseJson = await res.json()
      if (!res.ok) throw new Error(responseJson.error || 'Charge failed.')
      if (!responseJson.approved) throw new Error(responseJson.error || 'Charge declined.')

      setResult({
        type: 'success',
        msg: `${responseJson.isTest ? '[TEST MODE] ' : ''}Charge approved${responseJson.refNum ? ` — ref ${responseJson.refNum}` : ''}.${responseJson.warning ? ` ${responseJson.warning}` : ''}`,
      })
      onCharged?.()
    } catch (err) {
      setResult({ type: 'error', msg: err instanceof Error ? err.message : 'Charge failed.' })
    } finally {
      setCharging(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Charge Now</h2>
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Amount</label>
            <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">For</label>
            <select value={purpose} onChange={e => setPurpose(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {purposeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

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
                className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  newMethodType === 'card' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'
                }`}>
                Card
              </button>
              <button type="button" onClick={() => setNewMethodType('ach')}
                className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  newMethodType === 'ach' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'
                }`}>
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

        <button
          onClick={charge}
          disabled={charging}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          {charging && <Loader2 size={15} className="animate-spin" />}
          {charging ? 'Charging…' : 'Charge Now'}
        </button>
      </div>
    </div>
  )
}
