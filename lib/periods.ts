import { SCHOOL_YEAR_SEMESTERS, schoolYearIndexForDate } from '@/lib/semesters'

// A reporting period for the Tuition / Donations / Pledges list pages: a
// whole school year, one semester of one, or everything on file. Encoded
// as a plain string ("all", "y:2026–2027", "s:2026–2027:0") so it fits a
// <select> value directly.
export type Period =
  | { kind: 'all' }
  | { kind: 'year'; year: string }
  | { kind: 'semester'; year: string; index: 0 | 1 | 2 }

export function encodePeriod(p: Period): string {
  return p.kind === 'all' ? 'all' : p.kind === 'year' ? `y:${p.year}` : `s:${p.year}:${p.index}`
}

export function decodePeriod(value: string): Period {
  if (value.startsWith('y:')) return { kind: 'year', year: value.slice(2) }
  if (value.startsWith('s:')) {
    const [, year, index] = value.split(':')
    return { kind: 'semester', year, index: Number(index) as 0 | 1 | 2 }
  }
  return { kind: 'all' }
}

export function periodLabel(p: Period): string {
  return p.kind === 'all' ? 'All years' : p.kind === 'year' ? p.year : `${p.year} · Semester ${p.index + 1}`
}

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The school year we're in now (or the one that most recently began, during
// the summer break) — the default period on every page that uses this.
export function currentSchoolYear(): string {
  return SCHOOL_YEAR_SEMESTERS[schoolYearIndexForDate(localToday())].year
}

export function currentYearPeriod(): Period {
  return { kind: 'year', year: currentSchoolYear() }
}

function dayBefore(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Inclusive date range a period covers, for filtering date-stamped records
// (donations, pledges, per-month tuition buckets). Unlike the official
// semester dates, these ranges are contiguous: each semester runs until the
// day before the next one starts, and a year runs until the day before the
// next year's Semester 1, so something dated during a break (e.g. between
// Tishrei and Cheshvan, or over the summer) still lands in exactly one
// period instead of none. null = no restriction (all years), or a year
// that isn't in SCHOOL_YEAR_SEMESTERS so has no known dates.
export function periodDateRange(p: Period): { start: string; end: string } | null {
  if (p.kind === 'all') return null
  const gi = SCHOOL_YEAR_SEMESTERS.findIndex(g => g.year === p.year)
  if (gi === -1) return null
  const group = SCHOOL_YEAR_SEMESTERS[gi]
  const next = SCHOOL_YEAR_SEMESTERS[gi + 1]
  const yearEnd = next ? dayBefore(next.semesters[0].startDate) : group.semesters[2].endDate
  if (p.kind === 'year') return { start: group.semesters[0].startDate, end: yearEnd }
  const start = group.semesters[p.index].startDate
  const end = p.index < 2 ? dayBefore(group.semesters[p.index + 1].startDate) : yearEnd
  return { start, end }
}

export function inPeriod(date: string | null | undefined, p: Period): boolean {
  if (p.kind === 'all') return true
  const range = periodDateRange(p)
  return !!date && !!range && date >= range.start && date <= range.end
}

// Years offered by a page's picker: every year that has semester dates on
// file and has already started, plus any extra years that page's own data
// references (e.g. a legacy tuition plan year like 2022–2023) — newest first.
export function selectableYears(extraYears: Iterable<string> = []): string[] {
  const today = localToday()
  const years = new Set(SCHOOL_YEAR_SEMESTERS.filter(g => g.semesters[0].startDate <= today).map(g => g.year))
  for (const y of extraYears) if (y) years.add(y)
  return [...years].sort((a, b) => b.localeCompare(a))
}

export function hasSemesterDates(year: string): boolean {
  return SCHOOL_YEAR_SEMESTERS.some(g => g.year === year)
}
