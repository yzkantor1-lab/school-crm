'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

// Pinned to a specific stable release (docs.solapayments.com/products/ifields
// lists current versions at cdn.cardknox.com/ifields/versions.htm) rather than
// "latest", so a Sola-side version bump can't silently change behavior here.
const IFIELDS_VERSION = '3.5.2607.1401'
const IFRAME_SRC = `https://cdn.cardknox.com/ifields/${IFIELDS_VERSION}/ifield.htm`

// iFields collects card number / CVV / bank account number inside its own
// cross-origin iframes and hands back single-use tokens (SUTs) — raw card/
// account numbers never enter this app's DOM or server. This is also what
// keeps the school out of PCI-DSS scope.
//
// This talks to each iframe directly via postMessage, following the exact
// protocol Cardknox's own official React wrapper uses (verified against
// github.com/cardknox/react-cardknox-ifields — src/iField.js, src/constants.js).
// An earlier version of this file used the alternative vanilla-JS pattern —
// a global ifields.min.js script exposing window.setAccount()/getTokens(),
// which auto-scans the DOM for data-ifields-id elements — but that never
// actually delivered a token in production here (getTokens() reported
// success with nothing tokenized). Talking to each iframe's contentWindow
// directly removes that layer of unverifiable "magic" DOM-scanning.
const ACTION = {
  PING: 'ping',
  LOADED: 'loaded',
  SET_ACCOUNT_DATA: 'setAccountData',
  INIT: 'init',
  SET_PLACEHOLDER: 'setPlaceholder',
  GET_TOKEN: 'getToken',
  TOKEN: 'token',
} as const

type TokenMessageData = { result?: string; errorMessage?: string; xToken?: string; xTokenType?: string }

type IFieldHandle = { getToken: () => Promise<TokenMessageData> }

// One managed iField iframe — owns its own ping → loaded → setAccountData/
// init handshake, then answers getToken() on demand. Each instance only
// reacts to messages whose source is its own iframe's contentWindow, so
// multiple fields on the same page (card number + CVV) never cross-talk.
const IFieldFrame = forwardRef<IFieldHandle, {
  type: 'card' | 'cvv' | 'ach'
  iFieldsKey: string
  placeholder: string
  className: string
  onLoaded?: () => void
  onLoadError?: () => void
}>(function IFieldFrame({ type, iFieldsKey, placeholder, className, onLoaded, onLoadError }, ref) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const loadedRef = useRef(false)
  const pendingRef = useRef<{ resolve: (d: TokenMessageData) => void; reject: (e: Error) => void } | null>(null)

  useEffect(() => {
    function post(message: Record<string, unknown>) {
      iframeRef.current?.contentWindow?.postMessage(message, '*')
    }

    function onMessage(e: MessageEvent) {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const msg = e.data as { action?: string; data?: TokenMessageData } | undefined
      if (!msg?.action) return

      if (msg.action === ACTION.LOADED) {
        loadedRef.current = true
        post({ action: ACTION.SET_ACCOUNT_DATA, data: { xKey: iFieldsKey, xSoftwareName: 'SchoolCRM', xSoftwareVersion: '1.0' } })
        post({ action: ACTION.INIT, tokenType: type, referrer: window.location.toString() })
        if (placeholder) post({ action: ACTION.SET_PLACEHOLDER, data: placeholder })
        onLoaded?.()
      } else if (msg.action === ACTION.TOKEN) {
        const pending = pendingRef.current
        pendingRef.current = null
        if (!pending) return
        if (msg.data?.result === 'error') pending.reject(new Error(msg.data.errorMessage || 'Tokenization failed.'))
        else pending.resolve(msg.data ?? {})
      }
    }

    window.addEventListener('message', onMessage)
    post({ action: ACTION.PING })

    const loadTimeout = setTimeout(() => { if (!loadedRef.current) onLoadError?.() }, 20000)

    return () => { window.removeEventListener('message', onMessage); clearTimeout(loadTimeout) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    getToken: () => new Promise<TokenMessageData>((resolve, reject) => {
      if (!loadedRef.current || !iframeRef.current?.contentWindow) { reject(new Error('Payment field is not ready yet.')); return }
      pendingRef.current = { resolve, reject }
      iframeRef.current.contentWindow.postMessage({ action: ACTION.GET_TOKEN }, '*')
      setTimeout(() => {
        if (pendingRef.current) { pendingRef.current = null; reject(new Error('Tokenization timed out.')) }
      }, 30000)
    }),
  }))

  return <iframe ref={iframeRef} title={type} className={className} src={IFRAME_SRC} />
})

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
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState('')
  const [exp, setExp] = useState('')
  const [routing, setRouting] = useState('')
  const [accountType, setAccountType] = useState<'checking' | 'savings'>('checking')

  const iFieldsKey = process.env.NEXT_PUBLIC_SOLA_IFIELDS_KEY
  const cardNumRef = useRef<IFieldHandle>(null)
  const cvvRef = useRef<IFieldHandle>(null)
  const achRef = useRef<IFieldHandle>(null)

  useEffect(() => {
    if (!iFieldsKey) setLoadError('Sola iFields key is not configured.')
  }, [iFieldsKey])

  useImperativeHandle(ref, () => ({
    getToken: async () => {
      if (method === 'ach' && (!routing.trim() || !name.trim())) {
        throw new Error('Enter the routing number and name on the account.')
      }

      if (method === 'card') {
        const card = await cardNumRef.current!.getToken()
        if (!card.xToken) throw new Error('Could not tokenize the card number — check it and try again.')
        // CVV is tokenized/validated too, but — same as before this rewrite —
        // only the card number's own token is ever forwarded to the server
        // (lib/sola/context.ts's NewPaymentMethodInput only carries one
        // token). This isn't a new gap introduced here.
        if (cvvRef.current) {
          const cvv = await cvvRef.current.getToken()
          if (!cvv.xToken) throw new Error('Could not tokenize the CVV — check it and try again.')
        }
        return { tokenType: 'cc' as const, token: card.xToken, label: name ? `Card — ${name}` : 'Card', exp, name }
      }

      const ach = await achRef.current!.getToken()
      if (!ach.xToken) throw new Error('Could not tokenize the account number — check it and try again.')
      return { tokenType: 'ach' as const, token: ach.xToken, label: name ? `Bank account — ${name}` : 'Bank account', routing, accountType, name }
    },
  }), [method, name, exp, routing, accountType])

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>
  if (!iFieldsKey) return null

  return (
    <div className="space-y-3">
      {!ready && <p className="text-xs text-slate-400">Loading payment form…</p>}
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
            <IFieldFrame
              ref={cardNumRef} type="card" iFieldsKey={iFieldsKey} placeholder="Card Number" className={iframeClass}
              onLoaded={() => setReady(true)} onLoadError={() => setLoadError('Payment field failed to load — check your connection and try again.')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">CVV</label>
              <IFieldFrame ref={cvvRef} type="cvv" iFieldsKey={iFieldsKey} placeholder="CVV" className={iframeClass} />
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
            <IFieldFrame
              ref={achRef} type="ach" iFieldsKey={iFieldsKey} placeholder="Account Number" className={iframeClass}
              onLoaded={() => setReady(true)} onLoadError={() => setLoadError('Payment field failed to load — check your connection and try again.')}
            />
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
