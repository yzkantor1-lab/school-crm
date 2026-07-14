'use client'

import { useState } from 'react'
import { Download, FileText, Sheet } from 'lucide-react'
import { exportToCSV, exportToPDF, type ExportColumn } from '@/lib/export'

type Props = {
  data: Record<string, unknown>[]
  columns: ExportColumn[]
  filename: string
  title?: string
  disabled?: boolean
  size?: 'sm' | 'md'       // sm = icon-only compact button for group headers
  label?: string            // override the default "Export (N)" label
}

export default function ExportButton({ data, columns, filename, title, disabled, size = 'md', label }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run(type: 'csv' | 'pdf') {
    setBusy(true)
    setOpen(false)
    if (type === 'csv') exportToCSV(data, columns, filename)
    else await exportToPDF(data, columns, filename, title ?? filename)
    setBusy(false)
  }

  const isEmpty = data.length === 0

  return (
    <div className="relative">
      {size === 'sm' ? (
        <button
          onClick={() => setOpen(v => !v)}
          disabled={disabled || busy || isEmpty}
          title={isEmpty ? 'No data' : `Export ${data.length} record${data.length !== 1 ? 's' : ''}`}
          className="flex items-center gap-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-1.5 py-1 rounded hover:bg-slate-100"
        >
          <Download size={13} />
          <span className="text-xs font-medium">Export</span>
        </button>
      ) : (
        <button
          onClick={() => setOpen(v => !v)}
          disabled={disabled || busy || isEmpty}
          title={isEmpty ? 'No data to export' : undefined}
          className="flex items-center gap-2 border border-slate-200 bg-white text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Download size={15} />
          {label ?? `Export${data.length > 0 ? ` (${data.length})` : ''}`}
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-slate-200 z-20 overflow-hidden">
            <button
              onClick={() => run('csv')}
              className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Sheet size={15} className="text-green-600" />
              Excel / CSV
            </button>
            <button
              onClick={() => run('pdf')}
              className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100"
            >
              <FileText size={15} className="text-red-500" />
              PDF
            </button>
          </div>
        </>
      )}
    </div>
  )
}
