'use client'

import { useState, useRef, useEffect } from 'react'
import { Bot, Send, User, Loader2, Mail, X } from 'lucide-react'

// Kept intentionally loose (not the full Anthropic SDK types) — this widget
// only ever treats `messages` as an opaque blob it got from the server and
// hands back verbatim; it never constructs or inspects blocks itself beyond
// what's needed to render bubbles and the one pending-confirmation card.
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] }

type PendingConfirmation = { toolUseId: string; name: string; input: Record<string, unknown> }

// Mounted once in the dashboard layout so it floats over every admin page —
// state lives here (not in a route), so the conversation survives normal
// in-app navigation and only resets on a full page reload.
export default function AssistantWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, pending, open])

  // Grow the request box with its content (so a long message stays fully
  // visible while typing) up to the CSS max-height, then scroll inside it.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [input, open])

  async function send(nextMessages: Message[], confirm?: { toolUseId: string; approved: boolean }) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, confirm }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong.')
      setMessages(data.messages)
      setPending(data.pendingConfirmation ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  function handleSend() {
    if (!input.trim() || loading) return
    const next: Message[] = [...messages, { role: 'user', content: input.trim() }]
    setInput('')
    setMessages(next)
    send(next)
  }

  function handleConfirm(approved: boolean) {
    if (!pending) return
    const toolUseId = pending.toolUseId
    setPending(null)
    send(messages, { toolUseId, approved })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        className="fixed bottom-5 right-5 z-50 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-lg transition"
      >
        <Bot size={22} />
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[min(24rem,calc(100vw-2.5rem))] h-[min(40rem,calc(100vh-6rem))] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-blue-600 text-white shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={18} />
          <span className="font-semibold text-sm">Assistant</span>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close assistant" className="text-blue-100 hover:text-white">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-slate-400 text-center mt-6">
            Try: &ldquo;What&rsquo;s the Levin family&rsquo;s tuition balance?&rdquo; or &ldquo;How much has the Klein family given this year?&rdquo;
          </p>
        )}
        {messages.map((m, i) => <Bubble key={i} message={m} />)}
        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-xs">
            <Loader2 size={13} className="animate-spin" /> Thinking…
          </div>
        )}
        {pending && <ConfirmCard pending={pending} onConfirm={handleConfirm} disabled={loading} />}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-slate-200 p-3 shrink-0">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Ask the assistant…"
          disabled={loading || !!pending}
          className="flex-1 resize-none max-h-60 overflow-y-auto rounded-lg border border-slate-300 px-3 py-2 text-sm leading-5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
        />
        <button
          onClick={handleSend}
          disabled={loading || !!pending || !input.trim()}
          aria-label="Send"
          className="bg-blue-600 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  )
}

function Bubble({ message }: { message: Message }) {
  if (typeof message.content === 'string') {
    return message.role === 'user' ? <UserBubble text={message.content} /> : <AssistantBubble text={message.content} />
  }
  // Assistant turns can mix a text block with a tool_use block (e.g. "Let me
  // look that up" + the call) — show the text and quietly drop the tool
  // plumbing, which isn't meant for staff to read directly.
  const text = message.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join('\n')
  if (!text) return null
  return message.role === 'user' ? <UserBubble text={text} /> : <AssistantBubble text={text} />
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end gap-2">
      <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3 py-1.5 text-sm max-w-[85%] whitespace-pre-wrap">{text}</div>
      <div className="bg-slate-200 rounded-full p-1 h-fit"><User size={12} /></div>
    </div>
  )
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-2">
      <div className="bg-blue-600 text-white rounded-full p-1 h-fit"><Bot size={12} /></div>
      <div className="bg-slate-100 text-slate-800 rounded-2xl rounded-tl-sm px-3 py-1.5 text-sm max-w-[85%] whitespace-pre-wrap">{text}</div>
    </div>
  )
}

// Human-readable label + field list for each write tool's confirmation
// card. Anything not listed here (a future tool, or one we forgot to add)
// still gets a safe generic fallback below rather than being silently
// unrenderable — approving stays possible even for an "unforeseen" tool.
// `danger` swaps the card to a red delete-style treatment instead of the
// normal amber "about to write something" one — reserved for the tools
// that permanently remove a record (recoverable via undo, but that's
// not obvious from the confirmation moment itself, so it should still read
// as more consequential than a normal add/edit).
const CONFIRM_LABELS: Record<string, { title: string; fields: [string, string][]; danger?: boolean }> = {
  record_donation: { title: 'Record this donation?', fields: [['donorId', 'Donor'], ['amount', 'Amount'], ['donationDate', 'Date'], ['donationMethod', 'Method'], ['purpose', 'Purpose'], ['category', 'Category'], ['notes', 'Notes']] },
  update_donation: { title: 'Save these changes to the donation?', fields: [['donationId', 'Donation'], ['amount', 'New amount'], ['donationDate', 'New date'], ['donationMethod', 'New method'], ['purpose', 'New purpose'], ['category', 'New category'], ['notes', 'New notes']] },
  delete_donation: { title: 'Permanently delete this donation?', fields: [['donationId', 'Donation'], ['reason', 'Reason']], danger: true },
  add_donor: { title: 'Create this donor?', fields: [['name', 'Name'], ['email', 'Email'], ['phoneNumber', 'Phone'], ['address', 'Address'], ['category', 'Category'], ['relationship', 'Relationship']] },
  update_donor: { title: 'Save these changes to the donor?', fields: [['donorId', 'Donor'], ['name', 'New name'], ['title', 'New title'], ['email', 'New email'], ['phoneNumber', 'New phone'], ['address', 'New address'], ['category', 'New category'], ['relationship', 'New relationship']] },
  record_tuition_payment: { title: 'Record this payment?', fields: [['studentId', 'Student'], ['paymentType', 'Type'], ['amount', 'Amount'], ['paymentDate', 'Date'], ['paymentMethod', 'Method'], ['notes', 'Notes']] },
  update_tuition_payment: { title: 'Save these changes to the payment?', fields: [['paymentId', 'Payment'], ['amount', 'New amount'], ['paymentDate', 'New date'], ['paymentType', 'New type'], ['paymentMethod', 'New method'], ['status', 'New status'], ['notes', 'New notes']] },
  delete_tuition_payment: { title: 'Permanently delete this payment?', fields: [['paymentId', 'Payment'], ['reason', 'Reason']], danger: true },
  add_student: { title: 'Create this student record?', fields: [['firstName', 'First name'], ['lastName', 'Last name'], ['gradeLevel', 'Grade'], ['status', 'Status'], ['enrollmentDate', 'Enrollment date'], ['fatherName', 'Father'], ['motherName', 'Mother']] },
  log_expense: { title: 'Log this expense?', fields: [['date', 'Date'], ['category', 'Category'], ['description', 'Description'], ['amount', 'Amount'], ['vendor', 'Vendor'], ['paymentMethod', 'Method']] },
  add_pledge: { title: 'Create this pledge?', fields: [['donorId', 'Donor'], ['amount', 'Amount'], ['pledgeDate', 'Pledge date'], ['dueDate', 'Due date'], ['purpose', 'Purpose']] },
  record_pledge_payment: { title: 'Record this pledge payment?', fields: [['pledgeId', 'Pledge'], ['amount', 'Amount'], ['paymentDate', 'Date'], ['paymentMethod', 'Method']] },
  update_expense: { title: 'Save these changes to the expense?', fields: [['expenseId', 'Expense'], ['amount', 'New amount'], ['date', 'New date'], ['category', 'New category'], ['description', 'New description'], ['vendor', 'New vendor'], ['paymentMethod', 'New method'], ['notes', 'New notes']] },
  delete_expense: { title: 'Permanently delete this expense?', fields: [['expenseId', 'Expense'], ['reason', 'Reason']], danger: true },
  update_pledge: { title: 'Save these changes to the pledge?', fields: [['pledgeId', 'Pledge'], ['amount', 'New amount'], ['pledgeDate', 'New pledge date'], ['dueDate', 'New due date'], ['purpose', 'New purpose'], ['notes', 'New notes']] },
  delete_pledge: { title: 'Permanently delete this pledge?', fields: [['pledgeId', 'Pledge'], ['reason', 'Reason']], danger: true },
  update_pledge_payment: { title: 'Save these changes to the pledge payment?', fields: [['pledgePaymentId', 'Pledge payment'], ['amount', 'New amount'], ['paymentDate', 'New date'], ['paymentMethod', 'New method'], ['notes', 'New notes']] },
  delete_pledge_payment: { title: 'Permanently delete this pledge payment?', fields: [['pledgePaymentId', 'Pledge payment'], ['reason', 'Reason']], danger: true },
  undo_last_change: { title: 'Undo this change?', fields: [['actionId', 'Specific action']] },
  redo_last_undo: { title: 'Redo this undone change?', fields: [['actionId', 'Specific action']] },
}

function ConfirmCard({ pending, onConfirm, disabled }: { pending: PendingConfirmation; onConfirm: (approved: boolean) => void; disabled: boolean }) {
  if (pending.name === 'send_email') {
    const to = Array.isArray(pending.input.to) ? (pending.input.to as string[]).join(', ') : ''
    return (
      <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 text-xs space-y-2">
        <p className="font-medium text-amber-800 flex items-center gap-1.5"><Mail size={13} /> Ready to send this email?</p>
        <div className="bg-white rounded-lg p-2.5 space-y-1 text-slate-700">
          <p><span className="text-slate-400">To:</span> {to}</p>
          <p><span className="text-slate-400">Subject:</span> {String(pending.input.subject ?? '')}</p>
          <p className="whitespace-pre-wrap pt-1 border-t border-slate-100">{String(pending.input.body ?? '')}</p>
        </div>
        <Actions onConfirm={onConfirm} disabled={disabled} />
      </div>
    )
  }

  const config = CONFIRM_LABELS[pending.name]
  if (config) {
    const shownFields = config.fields.filter(([key]) => pending.input[key] != null && pending.input[key] !== '')
    return (
      <div className={`border rounded-xl p-3 text-xs space-y-2 ${config.danger ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
        <p className={`font-medium ${config.danger ? 'text-red-800' : 'text-amber-800'}`}>{config.title}</p>
        {shownFields.length > 0 && (
          <div className="bg-white rounded-lg p-2.5 space-y-1 text-slate-700">
            {shownFields.map(([key, label]) => (
              <p key={key}><span className="text-slate-400">{label}:</span> {String(pending.input[key])}</p>
            ))}
          </div>
        )}
        {!shownFields.length && (pending.name === 'undo_last_change' || pending.name === 'redo_last_undo') && (
          <p className="text-slate-500">Applies to the most recent {pending.name === 'undo_last_change' ? 'undoable' : 'undone'} change.</p>
        )}
        <Actions onConfirm={onConfirm} disabled={disabled} danger={config.danger} />
      </div>
    )
  }

  return (
    <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 text-xs">
      <p className="font-medium text-amber-800 mb-2">Approve this action ({pending.name})?</p>
      <pre className="text-xs bg-white rounded p-2 overflow-x-auto">{JSON.stringify(pending.input, null, 2)}</pre>
      <Actions onConfirm={onConfirm} disabled={disabled} />
    </div>
  )
}

function Actions({ onConfirm, disabled, danger }: { onConfirm: (approved: boolean) => void; disabled: boolean; danger?: boolean }) {
  return (
    <div className="flex gap-2 pt-1">
      <button onClick={() => onConfirm(true)} disabled={disabled} className={`text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${danger ? 'bg-red-600' : 'bg-blue-600'}`}>
        {danger ? 'Delete' : 'Approve'}
      </button>
      <button onClick={() => onConfirm(false)} disabled={disabled} className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
        {danger ? 'Cancel' : 'Decline'}
      </button>
    </div>
  )
}
