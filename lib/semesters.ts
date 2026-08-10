// Three-semester Jewish academic calendar.
// Semester 1: 1 Elul → 11 Tishrei (day after Yom Kippur)
// Semester 2: 1 Cheshvan → 1 Nissan
// Semester 3: 1 Iyar → 1 Av
//
// Gregorian dates verified against 1 Av 5786 = Jul 15, 2026 (user-confirmed).
// Dates may shift ±1 day at sunset; shown here as the daytime calendar date.

export type SemesterOption = {
  value: string     // stored in DB ("2025–2026 Semester 1")
  label: string     // dropdown display with Hebrew + Gregorian dates
  startDate: string // ISO "YYYY-MM-DD" — plan start date
  endDate: string   // ISO "YYYY-MM-DD" — plan end date
}

export type SchoolYearGroup = {
  year: string
  semesters: [SemesterOption, SemesterOption, SemesterOption]
}

export const SCHOOL_YEAR_SEMESTERS: SchoolYearGroup[] = [
  {
    year: '2023–2024',
    semesters: [
      {
        value: '2023–2024 Semester 1',
        label: 'Semester 1 · 1 Elul 5783 – 11 Tishrei 5784  (Aug 17 – Sep 25, 2023)',
        startDate: '2023-08-17',
        endDate:   '2023-09-25',
      },
      {
        value: '2023–2024 Semester 2',
        label: 'Semester 2 · 1 Cheshvan 5784 – 1 Nissan 5784  (Oct 15, 2023 – Apr 8, 2024)',
        startDate: '2023-10-15',
        endDate:   '2024-04-08',
      },
      {
        value: '2023–2024 Semester 3',
        label: 'Semester 3 · 1 Iyar 5784 – 1 Av 5784  (May 8 – Aug 4, 2024)',
        startDate: '2024-05-08',
        endDate:   '2024-08-04',
      },
    ],
  },
  {
    year: '2024–2025',
    semesters: [
      {
        value: '2024–2025 Semester 1',
        label: 'Semester 1 · 1 Elul 5784 – 11 Tishrei 5785  (Sep 3 – Oct 12, 2024)',
        startDate: '2024-09-03',
        endDate:   '2024-10-12',
      },
      {
        value: '2024–2025 Semester 2',
        label: 'Semester 2 · 1 Cheshvan 5785 – 1 Nissan 5785  (Nov 1, 2024 – Mar 29, 2025)',
        startDate: '2024-11-01',
        endDate:   '2025-03-29',
      },
      {
        value: '2024–2025 Semester 3',
        label: 'Semester 3 · 1 Iyar 5785 – 1 Av 5785  (Apr 28 – Jul 25, 2025)',
        startDate: '2025-04-28',
        endDate:   '2025-07-25',
      },
    ],
  },
  {
    year: '2025–2026',
    semesters: [
      {
        value: '2025–2026 Semester 1',
        label: 'Semester 1 · 1 Elul 5785 – 11 Tishrei 5786  (Aug 24 – Oct 2, 2025)',
        startDate: '2025-08-24',
        endDate:   '2025-10-02',
      },
      {
        value: '2025–2026 Semester 2',
        label: 'Semester 2 · 1 Cheshvan 5786 – 1 Nissan 5786  (Oct 22, 2025 – Mar 19, 2026)',
        startDate: '2025-10-22',
        endDate:   '2026-03-19',
      },
      {
        value: '2025–2026 Semester 3',
        label: 'Semester 3 · 1 Iyar 5786 – 1 Av 5786  (Apr 18 – Jul 15, 2026)',
        startDate: '2026-04-18',
        endDate:   '2026-07-15',
      },
    ],
  },
  {
    year: '2026–2027',
    semesters: [
      {
        value: '2026–2027 Semester 1',
        label: 'Semester 1 · 1 Elul 5786 – 11 Tishrei 5787  (Aug 14 – Sep 22, 2026)',
        startDate: '2026-08-14',
        endDate:   '2026-09-22',
      },
      {
        value: '2026–2027 Semester 2',
        label: 'Semester 2 · 1 Cheshvan 5787 – 1 Nissan 5787  (Oct 12, 2026 – Apr 6, 2027)',
        startDate: '2026-10-12',
        endDate:   '2027-04-06',
      },
      {
        value: '2026–2027 Semester 3',
        label: 'Semester 3 · 1 Iyar 5787 – 1 Av 5787  (May 6 – Aug 2, 2027)',
        startDate: '2027-05-06',
        endDate:   '2027-08-02',
      },
    ],
  },
  {
    year: '2027–2028',
    semesters: [
      {
        value: '2027–2028 Semester 1',
        label: 'Semester 1 · 1 Elul 5787 – 11 Tishrei 5788  (Sep 1 – Oct 10, 2027)',
        startDate: '2027-09-01',
        endDate:   '2027-10-10',
      },
      {
        value: '2027–2028 Semester 2',
        label: 'Semester 2 · 1 Cheshvan 5788 – 1 Nissan 5788  (Oct 30, 2027 – Mar 25, 2028)',
        startDate: '2027-10-30',
        endDate:   '2028-03-25',
      },
      {
        value: '2027–2028 Semester 3',
        label: 'Semester 3 · 1 Iyar 5788 – 1 Av 5788  (Apr 24 – Jul 21, 2028)',
        startDate: '2028-04-24',
        endDate:   '2028-07-21',
      },
    ],
  },
]

// Flat lookup by value string → SemesterOption
export const SEMESTER_BY_VALUE = new Map<string, SemesterOption>(
  SCHOOL_YEAR_SEMESTERS.flatMap(g => g.semesters.map(s => [s.value, s]))
)

// Set of all known values (for legacy detection)
export const ALL_SEMESTER_VALUES = new Set(SEMESTER_BY_VALUE.keys())

// True if an ISO "YYYY-MM-DD" date is still in the future.
export function isDateUpcoming(dateStr: string | null | undefined): boolean {
  return !!dateStr && dateStr > new Date().toISOString().slice(0, 10)
}

// True if the semester a student is coming in hasn't started yet. Used to
// show a "Pending" badge instead of "Active" — purely cosmetic, computed
// live from today's date rather than stored, so it flips to Active on its
// own the day the semester starts without any background job. The student's
// actual `status` stays 'active' the whole time, so tuition/payments/etc.
// are never gated by this.
export function isSemesterUpcoming(cameSemester: string | null | undefined): boolean {
  if (!cameSemester) return false
  return isDateUpcoming(SEMESTER_BY_VALUE.get(cameSemester)?.startDate)
}

// Status label to actually display for a student — 'pending' overrides an
// 'active' DB status when their starting semester is still in the future.
export function studentDisplayStatus(status: string | null | undefined, cameSemester: string | null | undefined): string {
  if (status === 'active' && isSemesterUpcoming(cameSemester)) return 'pending'
  return status || 'unknown'
}

export const GRADE_LEVELS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year']

// The school year (index into SCHOOL_YEAR_SEMESTERS) we're currently in, or
// most recently started — the last year whose Semester 1 has already begun.
// Falls back to index 0 if today is before the earliest year on file.
function schoolYearIndexForDate(dateStr: string): number {
  let idx = 0
  for (let i = 0; i < SCHOOL_YEAR_SEMESTERS.length; i++) {
    if (SCHOOL_YEAR_SEMESTERS[i].semesters[0].startDate <= dateStr) idx = i
  }
  return idx
}

// came_semester's academic-year prefix ("2025–2026 Semester 3" → index of
// the "2025–2026" group), or null for a blank/legacy value we can't place.
function schoolYearIndexForSemester(cameSemester: string | null | undefined): number | null {
  if (!cameSemester) return null
  const idx = SCHOOL_YEAR_SEMESTERS.findIndex(g => cameSemester.startsWith(g.year))
  return idx === -1 ? null : idx
}

// The grade level stored on the student record is what they STARTED at
// (set once, alongside came_semester) — this computes what grade they're
// actually in NOW by advancing one step per academic year that's begun
// since then, same "live-computed, never stored, no cron job" pattern as
// isSemesterUpcoming/studentDisplayStatus. Caps at the last grade level —
// a Fourth Year student doesn't advance further; graduating them is a
// separate, manual staff action (Status → Graduated).
export function currentGradeLevel(startingGradeLevel: string | null | undefined, cameSemester: string | null | undefined): string | null {
  if (!startingGradeLevel) return null
  const startIdx = GRADE_LEVELS.indexOf(startingGradeLevel)
  if (startIdx === -1) return startingGradeLevel // legacy/free-text value — leave it alone rather than guess
  const startYearIdx = schoolYearIndexForSemester(cameSemester)
  if (startYearIdx === null) return startingGradeLevel // no came_semester on file — nothing to compute elapsed years from
  const currentYearIdx = schoolYearIndexForDate(new Date().toISOString().slice(0, 10))
  const yearsElapsed = Math.max(0, currentYearIdx - startYearIdx)
  return GRADE_LEVELS[Math.min(GRADE_LEVELS.length - 1, startIdx + yearsElapsed)]
}
