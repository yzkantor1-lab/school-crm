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

  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, pending, open])

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
    <div className="fixed bottom-5 right-5 z-50 w-[min(24rem,calc(100vw-2.5rem))] h-[min(32rem,calc(100vh-6rem))] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
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

      <div className="flex gap-2 border-t border-slate-200 p-3 shrink-0">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Ask the assistant…"
          disabled={loading || !!pending}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
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

function ConfirmCard({ pending, onConfirm, disabled }: { pending: PendingConfirmation; onConfirm: (approved: boolean) => void; disabled: boolean }) {
  if (pending.name !== 'send_email') {
    return (
      <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 text-xs">
        <p className="font-medium text-amber-800 mb-2">Approve this action?</p>
        <pre className="text-xs bg-white rounded p-2 overflow-x-auto">{JSON.stringify(pending.input, null, 2)}</pre>
        <Actions onConfirm={onConfirm} disabled={disabled} />
      </div>
    )
  }
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

function Actions({ onConfirm, disabled }: { onConfirm: (approved: boolean) => void; disabled: boolean }) {
  return (
    <div className="flex gap-2 pt-1">
      <button onClick={() => onConfirm(true)} disabled={disabled} className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
        Approve & Send
      </button>
      <button onClick={() => onConfirm(false)} disabled={disabled} className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
        Decline
      </button>
    </div>
  )
}
