'use client'

import { useState } from 'react'
import { X, Eye } from 'lucide-react'
import { openPreviewTab } from '@/lib/pdfPreview'

const FONT_SIZES = [
  { label: 'Small', value: 7 },
  { label: 'Normal', value: 9 },
  { label: 'Large', value: 11 },
  { label: 'X-Large', value: 13 },
]

// A real modal instead of window.prompt() — native prompt() has to run on
// the same tab as the click that triggered it, but the PDF preview also
// needs a window.open() call from that same click to avoid being popup-
// blocked. Opening the preview tab first (before the prompt) shifts focus
// away from this tab, and browsers then silently suppress a prompt() fired
// from a backgrounded tab; opening it after the prompt is too late for the
// popup blocker. A modal has neither problem — the actual window.open()
// only happens inside this modal's own button clicks, each its own fresh,
// direct user gesture.
//
// Doubles as the note-composing step before emailing (not just printing):
// onPreview, when provided, lets staff see the actual PDF — note, font
// size, and all — in a new tab before committing, without leaving this
// modal, so the text or size can be adjusted and re-previewed as many
// times as needed before Continue moves on to actually sending it.
export default function PrintNoteModal({
  title, onConfirm, onClose, onPreview, confirmLabel = 'Continue',
}: {
  title: string
  onConfirm: (note: string | undefined, fontSize: number) => void
  onClose: () => void
  onPreview?: (note: string | undefined, fontSize: number, win: Window | null) => void
  confirmLabel?: string
}) {
  const [note, setNote] = useState('')
  const [fontSize, setFontSize] = useState(9)

  function preview() {
    const win = openPreviewTab()
    onPreview?.(note.trim() || undefined, fontSize, win)
  }

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
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Note text size</label>
          <div className="flex gap-2">
            {FONT_SIZES.map(f => (
              <button key={f.value} type="button" onClick={() => setFontSize(f.value)}
                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  fontSize === f.value ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {onPreview && (
            <button
              onClick={preview}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Eye size={14} /> Preview
            </button>
          )}
          <button
            onClick={() => onConfirm(note.trim() || undefined, fontSize)}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {confirmLabel}
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
