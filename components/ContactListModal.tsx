'use client'

import { useState } from 'react'
import { X, Download } from 'lucide-react'
import { exportToCSV } from '@/lib/export'
import { studentDisplayStatus } from '@/lib/semesters'

type ContactStudent = {
  id: string
  first_name: string | null
  last_name: string | null
  status: string | null
  came_semester: string | null
  father_email: string | null
  mother_email: string | null
  father_cell: string | null
  mother_cell: string | null
  home_phone: string | null
}

const FIELD_DEFS = [
  { key: 'father_email' as const, label: 'Father Email' },
  { key: 'mother_email' as const, label: 'Mother Email' },
  { key: 'father_cell' as const,  label: 'Father Cell' },
  { key: 'mother_cell' as const,  label: 'Mother Cell' },
  { key: 'home_phone' as const,   label: 'Home Phone' },
]

function studentName(s: ContactStudent) {
  return [s.first_name, s.last_name].filter(Boolean).join(' ') || 'Unknown'
}

export default function ContactListModal({ students, onClose }: { students: ContactStudent[]; onClose: () => void }) {
  const [fields, setFields] = useState<Set<string>>(new Set(['father_email', 'mother_email']))
  const [shape, setShape] = useState<'columns' | 'flat'>('columns')
  const [dedupe, setDedupe] = useState(true)

  function toggleField(key: string) {
    setFields(f => {
      const next = new Set(f)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const selectedDefs = FIELD_DEFS.filter(f => fields.has(f.key))

  function buildAndDownload() {
    if (selectedDefs.length === 0 || students.length === 0) return

    if (shape === 'columns') {
      const columns = [
        { header: 'Student', key: 'studentName' },
        { header: 'Status', key: 'statusLabel' },
        ...selectedDefs.map(f => ({ header: f.label, key: f.key })),
      ]
      const data = students.map(s => ({
        studentName: studentName(s),
        statusLabel: studentDisplayStatus(s.status, s.came_semester),
        ...Object.fromEntries(selectedDefs.map(f => [f.key, s[f.key] ?? ''])),
      }))
      exportToCSV(data, columns, 'student-contacts')
    } else {
      const columns = [{ header: 'Student', key: 'studentName' }, { header: 'Contact', key: 'value' }]
      const seen = new Set<string>()
      const data: { studentName: string; value: string }[] = []
      for (const s of students) {
        for (const f of selectedDefs) {
          const value = s[f.key]?.trim()
          if (!value) continue
          if (dedupe) {
            const lower = value.toLowerCase()
            if (seen.has(lower)) continue
            seen.add(lower)
          }
          data.push({ studentName: studentName(s), value })
        }
      }
      exportToCSV(data, columns, 'student-contacts')
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Build Contact List CSV</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <p className="text-xs text-slate-500">{students.length} student{students.length !== 1 ? 's' : ''} included.</p>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2">Include</label>
          <div className="space-y-1.5">
            {FIELD_DEFS.map(f => (
              <label key={f.key} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fields.has(f.key)}
                  onChange={() => toggleField(f.key)}
                  className="w-3.5 h-3.5 text-blue-600 rounded"
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2">Format</label>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="radio" name="shape" checked={shape === 'columns'} onChange={() => setShape('columns')}
                className="mt-0.5 w-3.5 h-3.5 text-blue-600" />
              <span>
                One row per student
                <span className="text-slate-400 text-xs block">Separate columns per field — good for reference or mail-merge tools.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="radio" name="shape" checked={shape === 'flat'} onChange={() => setShape('flat')}
                className="mt-0.5 w-3.5 h-3.5 text-blue-600" />
              <span>
                Flat list
                <span className="text-slate-400 text-xs block">One contact value per row — easiest to paste straight into a BCC field.</span>
              </span>
            </label>
          </div>
        </div>

        {shape === 'flat' && (
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
            <input type="checkbox" checked={dedupe} onChange={e => setDedupe(e.target.checked)}
              className="w-3.5 h-3.5 text-blue-600 rounded" />
            Remove duplicate values
          </label>
        )}

        <div className="flex justify-end pt-1">
          <button
            onClick={buildAndDownload}
            disabled={selectedDefs.length === 0 || students.length === 0}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Download size={14} /> Download CSV
          </button>
        </div>
      </div>
    </div>
  )
}
