'use client'

import { forwardRef, useEffect, useId, useImperativeHandle, useState } from 'react'

// Pinned to a specific stable release (docs.solapayments.com/products/ifields
// lists current versions at cdn.cardknox.com/ifields/versions.htm) rather than
// "latest", so a Sola-side version bump can't silently change behavior here.
const IFIELDS_VERSION = '3.5.2607.1401'
const IFIELDS_BASE = `https://cdn.cardknox.com/ifields/${IFIELDS_VERSION}`

// iFields collects card number / CVV / bank account number inside its own
// iframes and hands back single-use tokens (SUTs) — raw card/account numbers
// never enter this app's DOM or server. This is also what keeps the school
// out of PCI-DSS scope.
declare global {
  interface Window {
    setAccount?: (key: string, softwareName: string, version: string) => void
    // Cardknox's actual failure callback receives (overallError, invalidFieldIds)
    // — typed loosely since it's an untyped third-party global, but we read
    // both args now instead of discarding them, so a real failure reason
    // surfaces instead of a generic message.
    getTokens?: (onSuccess: () => void, onError: (err: unknown, invalidFields?: unknown) => void, timeoutMs: number) => void
  }
}

let scriptLoadPromise: Promise<void> | null = null
function loadIfieldsScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.setAccount) return Promise.resolve()
  if (!scriptLoadPromise) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `${IFIELDS_BASE}/ifields.min.js`
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Failed to load Sola payment fields — check your connection.'))
      document.head.appendChild(script)
    })
  }
  return scriptLoadPromise
}

export type PaymentToken = {
  tokenType: 'cc' | 'ach'
  token: string
  label: string
  exp?: string
  routing?: string
  accountType?: 'checking' | 'savings'
  name?: string
}

export type PaymentFieldsHandle = {
  getToken: () => Promise<PaymentToken>
}

const fieldClass = 'border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white'
const iframeClass = `${fieldClass} w-full h-[38px]`

const PaymentFields = forwardRef<PaymentFieldsHandle, { method: 'card' | 'ach' }>(function PaymentFields({ method }, ref) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState('')
  const [exp, setExp] = useState('')
  const [routing, setRouting] = useState('')
  const [accountType, setAccountType] = useState<'checking' | 'savings'>('checking')

  const cardNumId = `cardnum-${uid}`
  const cvvId = `cvv-${uid}`
  const achId = `ach-${uid}`

  useEffect(() => {
    let cancelled = false
    const iFieldsKey = process.env.NEXT_PUBLIC_SOLA_IFIELDS_KEY
    if (!iFieldsKey) { setLoadError('Sola iFields key is not configured.'); return }
    loadIfieldsScript()
      .then(() => {
        if (cancelled) return
        window.setAccount?.(iFieldsKey, 'SchoolCRM', '1.0')
        setReady(true)
      })
      .catch(err => setLoadError(err instanceof Error ? err.message : 'Failed to load payment fields.'))
    return () => { cancelled = true }
  }, [])

  useImperativeHandle(ref, () => ({
    getToken: () => new Promise<PaymentToken>((resolve, reject) => {
      if (!window.getTokens) { reject(new Error('Payment fields are not ready yet.')); return }
      if (method === 'ach' && (!routing.trim() || !name.trim())) {
        reject(new Error('Enter the routing number and name on the account.')); return
      }
      window.getTokens(
        () => {
          const tokenInputId = method === 'card' ? `${cardNumId}-token` : `${achId}-token`
          const token = (document.getElementById(tokenInputId) as HTMLInputElement | null)?.value
          if (!token) {
            // Cardknox reported success but no token landed in the DOM — log
            // every ifields-tracked element's state so the console shows
            // exactly which field(s) came back empty, instead of guessing.
            const trackedIds = method === 'card' ? [cardNumId, cvvId] : [achId]
            const debugState = trackedIds.map(id => {
              const el = document.getElementById(`${id}-token`) as HTMLInputElement | null
              return `${id}: ${el ? `element found, value="${el.value}"` : 'element NOT FOUND in DOM'}`
            })
            console.error('iFields getTokens() succeeded but token was empty.', { tokenInputId, debugState })
            reject(new Error(`Could not tokenize payment details — check the card/account number. (debug: ${debugState.join('; ')})`))
            return
          }
          resolve(
            method === 'card'
              ? { tokenType: 'cc', token, label: name ? `Card — ${name}` : 'Card', exp, name }
              : { tokenType: 'ach', token, label: name ? `Bank account — ${name}` : 'Bank account', routing, accountType, name }
          )
        },
        (err, invalidFields) => {
          console.error('iFields getTokens() error callback:', err, invalidFields)
          const detail = [
            typeof err === 'string' ? err : err instanceof Error ? err.message : JSON.stringify(err),
            invalidFields ? `invalid fields: ${JSON.stringify(invalidFields)}` : null,
          ].filter(Boolean).join(' — ')
          reject(new Error(`Tokenization failed: ${detail}`))
        },
        30000
      )
    }),
  }), [method, name, exp, routing, accountType, cardNumId, cvvId, achId])

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>
  if (!ready) return <p className="text-sm text-slate-400">Loading payment form…</p>

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">
          {method === 'card' ? 'Name on Card' : 'Name on Account'}
        </label>
        <input value={name} onChange={e => setName(e.target.value)} className={`${fieldClass} w-full`} />
      </div>

      {method === 'card' ? (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Card Number</label>
            <iframe title="Card Number" className={iframeClass} data-ifields-id={cardNumId} data-ifields-placeholder="Card Number" src={`${IFIELDS_BASE}/ifield.htm`} />
            <input type="hidden" name={cardNumId} data-ifields-id={`${cardNumId}-token`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">CVV</label>
              <iframe title="CVV" className={iframeClass} data-ifields-id={cvvId} data-ifields-placeholder="CVV" src={`${IFIELDS_BASE}/ifield.htm`} />
              <input type="hidden" name={cvvId} data-ifields-id={`${cvvId}-token`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Expiration (MMYY)</label>
              <input value={exp} onChange={e => setExp(e.target.value)} placeholder="1229" maxLength={4} className={`${fieldClass} w-full`} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Routing Number</label>
            <input value={routing} onChange={e => setRouting(e.target.value)} maxLength={9} className={`${fieldClass} w-full`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Account Number</label>
            <iframe title="Account Number" className={iframeClass} data-ifields-id={achId} data-ifields-placeholder="Account Number" src={`${IFIELDS_BASE}/ifield.htm`} />
            <input type="hidden" name={achId} data-ifields-id={`${achId}-token`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Account Type</label>
            <select value={accountType} onChange={e => setAccountType(e.target.value as 'checking' | 'savings')} className={`${fieldClass} w-full`}>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
            </select>
          </div>
        </>
      )}
    </div>
  )
})

export default PaymentFields
