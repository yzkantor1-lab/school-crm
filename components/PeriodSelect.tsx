'use client'

import { CalendarRange } from 'lucide-react'
import { encodePeriod, decodePeriod, hasSemesterDates, type Period } from '@/lib/periods'

// School year / semester / all-years picker shared by the Tuition,
// Donations, and Pledges list pages. Semesters are only offered for years
// whose semester dates are on file (lib/semesters.ts).
export default function PeriodSelect({ value, onChange, years }: {
  value: Period
  onChange: (p: Period) => void
  years: string[]
}) {
  return (
    <label className="flex items-center gap-2">
      <CalendarRange size={16} className="text-slate-400" />
      <span className="sr-only">Period</span>
      <select
        value={encodePeriod(value)}
        onChange={e => onChange(decodePeriod(e.target.value))}
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {years.map(year => (
          <optgroup key={year} label={year}>
            <option value={encodePeriod({ kind: 'year', year })}>{year} — full year</option>
            {hasSemesterDates(year) && ([0, 1, 2] as const).map(index => (
              <option key={index} value={encodePeriod({ kind: 'semester', year, index })}>{year} · Semester {index + 1}</option>
            ))}
          </optgroup>
        ))}
        <option value="all">All years</option>
      </select>
    </label>
  )
}
