'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

// A real modal instead of window.prompt() — native prompt() has to run on
// the same tab as the click that triggered it, but the PDF preview also
// needs a window.open() call from that same click to avoid being popup-
// blocked. Opening the preview tab first (before the prompt) shifts focus
// away from this tab, and browsers then silently suppress a prompt() fired
// from a backgrounded tab; opening it after the prompt is too late for the
// popup blocker. A modal has neither problem — the actual window.open()
// only happens inside this modal's own Continue click, which is itself a
// fresh, direct user gesture.
export default function PrintNoteModal({
  title, onConfirm, onClose,
}: {
  title: string
  onConfirm: (note: string | undefined) => void
  onClose: () => void
}) {
  const [note, setNote] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <textarea
          autoFocus
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={3}
          placeholder="Optional note to include…"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm(note.trim() || undefined)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Continue
          </button>
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
