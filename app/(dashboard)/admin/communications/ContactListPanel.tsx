'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Copy, Check, Mail, Phone, Smartphone, Users, GraduationCap } from 'lucide-react'

type StudentRow = {
  id: string
  first_name: string | null
  last_name: string | null
  status: string | null
  father_email: string | null
  mother_email: string | null
  personal_phone: string | null   // alumni personal
  home_phone: string | null
  father_cell: string | null
  mother_cell: string | null
}

type Audience = 'current' | 'alumni' | 'all'
type ContactType = 'emails' | 'home_phones' | 'father_cells' | 'mother_cells'

type ContactEntry = {
  studentName: string
  label: string        // e.g. "Father Email", "Home Phone"
  value: string
  isAlumni: boolean
}

const AUDIENCE_OPTIONS: { id: Audience; label: string; icon: React.ReactNode }[] = [
  { id: 'current', label: 'Current Students', icon: <Users size={14} /> },
  { id: 'alumni',  label: 'Alumni',           icon: <GraduationCap size={14} /> },
  { id: 'all',     label: 'All (Ever)',        icon: <Users size={14} /> },
]

const TYPE_OPTIONS: { id: ContactType; label: string; icon: React.ReactNode; description: string }[] = [
  { id: 'emails',       label: 'Emails',         icon: <Mail size={14} />,       description: 'Father & mother email addresses' },
  { id: 'home_phones',  label: 'Home Phones',    icon: <Phone size={14} />,      description: 'Family home phone numbers' },
  { id: 'father_cells', label: 'Father Cell',    icon: <Smartphone size={14} />, description: 'Father cell phones for texts' },
  { id: 'mother_cells', label: 'Mother Cell',    icon: <Smartphone size={14} />, description: 'Mother cell phones for texts' },
]

function buildEntries(students: StudentRow[], type: ContactType): ContactEntry[] {
  const entries: ContactEntry[] = []
  for (const s of students) {
    const name = [s.first_name, s.last_name].filter(Boolean).join(' ') || '—'
    const isAlumni = s.status === 'graduated'

    if (type === 'emails') {
      if (s.father_email) entries.push({ studentName: name, label: 'Father Email', value: s.father_email, isAlumni })
      if (s.mother_email) entries.push({ studentName: name, label: 'Mother Email', value: s.mother_email, isAlumni })
      // personal email for alumni (phone field — we use personal_phone column; no personal_email column yet, skip)
    } else if (type === 'home_phones') {
      if (s.home_phone) entries.push({ studentName: name, label: 'Home Phone', value: s.home_phone, isAlumni })
      if (isAlumni && s.personal_phone) entries.push({ studentName: name, label: 'Personal Phone', value: s.personal_phone, isAlumni })
    } else if (type === 'father_cells') {
      if (s.father_cell) entries.push({ studentName: name, label: 'Father Cell', value: s.father_cell, isAlumni })
    } else if (type === 'mother_cells') {
      if (s.mother_cell) entries.push({ studentName: name, label: 'Mother Cell', value: s.mother_cell, isAlumni })
    }
  }
  return entries
}

export default function ContactListPanel() {
  const supabase = createClient()
  const [rows, setRows] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [audience, setAudience] = useState<Audience>('current')
  const [contactType, setContactType] = useState<ContactType>('emails')
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase
      .from('students')
      .select('id,first_name,last_name,status,father_email,mother_email,personal_phone,home_phone,father_cell,mother_cell')
      .order('last_name')
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [supabase])

  const filtered = useMemo(() => {
    return rows.filter(s => {
      if (audience === 'current') return s.status !== 'graduated'
      if (audience === 'alumni')  return s.status === 'graduated'
      return true
    })
  }, [rows, audience])

  const entries = useMemo(() => buildEntries(filtered, contactType), [filtered, contactType])

  const searchedEntries = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(e =>
      e.studentName.toLowerCase().includes(q) ||
      e.value.toLowerCase().includes(q)
    )
  }, [entries, search])

  // Unique values only (deduplicated), for the copyable list
  const uniqueValues = useMemo(() => [...new Set(entries.map(e => e.value))], [entries])

  async function copyAll() {
    const separator = contactType === 'emails' ? ', ' : '\n'
    await navigator.clipboard.writeText(uniqueValues.join(separator))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isEmail = contactType === 'emails'

  // Group entries by student for display
  const grouped = useMemo(() => {
    const map = new Map<string, { isAlumni: boolean; entries: { label: string; value: string }[] }>()
    for (const e of searchedEntries) {
      if (!map.has(e.studentName)) map.set(e.studentName, { isAlumni: e.isAlumni, entries: [] })
      map.get(e.studentName)!.entries.push({ label: e.label, value: e.value })
    }
    return [...map.entries()]
  }, [searchedEntries])

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-900 text-base">Contact Lists</h2>
        <p className="text-xs text-slate-400 mt-0.5">Pull up email or phone lists to send group messages</p>
      </div>

      {/* Audience selector */}
      <div className="px-5 pt-4">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Audience</p>
        <div className="flex gap-2 flex-wrap">
          {AUDIENCE_OPTIONS.map(o => (
            <button
              key={o.id}
              onClick={() => setAudience(o.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                audience === o.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {o.icon} {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contact type selector */}
      <div className="px-5 pt-4">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Contact Type</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TYPE_OPTIONS.map(o => (
            <button
              key={o.id}
              onClick={() => setContactType(o.id)}
              className={`flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                contactType === o.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              <span className={contactType === o.id ? 'text-white' : 'text-slate-400'}>{o.icon}</span>
              <span className="text-xs font-semibold">{o.label}</span>
              <span className={`text-xs leading-tight ${contactType === o.id ? 'text-slate-300' : 'text-slate-400'}`}>{o.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Copyable address block */}
      <div className="px-5 pt-4">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {uniqueValues.length} unique {isEmail ? 'address' : 'number'}{uniqueValues.length !== 1 ? 'es' : ''}
            {audience !== 'all' && (
              <span className="ml-1 font-normal normal-case text-slate-400">
                — {audience === 'current' ? 'current students only' : 'alumni only'}
              </span>
            )}
          </p>
          <button
            onClick={copyAll}
            disabled={uniqueValues.length === 0}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
            {copied ? 'Copied!' : `Copy All${isEmail ? ' (comma-separated)' : ''}`}
          </button>
        </div>
        {loading ? (
          <div className="h-20 bg-slate-50 rounded-lg animate-pulse" />
        ) : (
          <textarea
            readOnly
            value={uniqueValues.join(isEmail ? ', ' : '\n')}
            onClick={e => (e.target as HTMLTextAreaElement).select()}
            rows={4}
            placeholder={`No ${contactType.replace('_', ' ')} found for this audience.`}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-slate-700 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-text"
          />
        )}
        <p className="text-xs text-slate-400 mt-1">
          Click the box to select all · {isEmail ? 'Ready to paste into Gmail / Outlook BCC field' : 'Ready to paste into your texting or calling app'}
        </p>
      </div>

      {/* Divider + search */}
      <div className="px-5 pt-5 pb-3 border-t border-slate-100 mt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Breakdown by student ({grouped.length})
          </p>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by name or value…"
            className="border border-slate-200 rounded-lg px-3 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
          />
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-12 bg-slate-50 rounded-lg animate-pulse" />)}
          </div>
        ) : grouped.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-6">
            {search ? 'No results match your filter.' : `No ${contactType.replace('_', ' ')} on file for this audience.`}
          </p>
        ) : (
          <div className="space-y-0 divide-y divide-slate-50 max-h-80 overflow-y-auto">
            {grouped.map(([name, { isAlumni, entries: studentEntries }]) => (
              <div key={name} className="flex items-start gap-3 py-2.5">
                <div className={`mt-0.5 p-1 rounded-md flex-shrink-0 ${isAlumni ? 'bg-amber-50' : 'bg-blue-50'}`}>
                  {isAlumni
                    ? <GraduationCap size={13} className="text-amber-500" />
                    : <Users size={13} className="text-blue-500" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-slate-800">{name}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${isAlumni ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                      {isAlumni ? 'Alumni' : 'Current'}
                    </span>
                  </div>
                  <div className="mt-0.5 space-y-0.5">
                    {studentEntries.map((e, i) => (
                      <p key={i} className="text-xs text-slate-500">
                        <span className="text-slate-400">{e.label}:</span>{' '}
                        <span className="font-mono">{e.value}</span>
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
