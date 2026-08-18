'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SCHOOL_YEAR_SEMESTERS, ALL_SEMESTER_VALUES, isSemesterUpcoming, GRADE_LEVELS, currentGradeLevel } from '@/lib/semesters'
import { loadGoogleMapsScript, type GoogleAutocomplete } from '@/lib/googleMaps'
import SmartFormField from '@/components/SmartFormField'
import NameInput from '@/components/NameInput'
import PhoneInput from '@/components/PhoneInput'

const field = (label: string, key: string, required = false) => ({ label, key, type: 'text', required })
const dateField = (label: string, key: string) => ({ label, key, type: 'date', required: false })

const BASIC_FIELDS = [
  field('First Name', 'first_name', true),
  field('Last Name', 'last_name', true),
  field('Student ID', 'student_id'),
  dateField('Date of Birth', 'date_of_birth'),
  dateField('Enrollment Date', 'enrollment_date'),
  field('Social Security Number', 'ssn'),
]

// Name fields render first (with a shared family Last Name right after them,
// same as First Name/Last Name on the student), then Cell/Email pairs.
const GRANDPARENT_NAME_FIELDS = (prefix: string) => ([
  ['Grandfather Name', `${prefix}_grandfather_name`, 'text'],
  ['Grandmother Name', `${prefix}_grandmother_name`, 'text'],
] as const)

const GRANDPARENT_CONTACT_FIELDS = (prefix: string) => ([
  ['Grandfather Cell',  `${prefix}_grandfather_cell`,  'tel'],
  ['Grandmother Cell',  `${prefix}_grandmother_cell`,  'tel'],
  ['Grandfather Email', `${prefix}_grandfather_email`, 'email'],
  ['Grandmother Email', `${prefix}_grandmother_email`, 'email'],
] as const)

const CONTACT_FIELDS = [
  field('Home Phone', 'home_phone'),
]

const PARENT_FIELDS = [
  field('Father Name', 'father_name'),
  field('Father Cell', 'father_cell'),
  field('Father Email', 'father_email'),
  field('Mother Name', 'mother_name'),
  field('Mother Cell', 'mother_cell'),
  field('Mother Email', 'mother_email'),
]

type StudentRow = Record<string, string | null>

// Every structured address group in this form, paired with the single-line
// legacy column it used to be. We keep writing that legacy column (derived
// from the structured fields on save) so every other page that still reads
// e.g. student.address or student.personal_address — donor pages, alumni
// list, tuition statements, PDFs — keeps working without changes.
const ADDRESS_GROUPS: { legacyKey: string; fieldPrefix: string }[] = [
  { legacyKey: 'address', fieldPrefix: 'address' },
  { legacyKey: 'paternal_grandparents_address', fieldPrefix: 'paternal_grandparents' },
  { legacyKey: 'maternal_grandparents_address', fieldPrefix: 'maternal_grandparents' },
  { legacyKey: 'step_paternal_grandparents_address', fieldPrefix: 'step_paternal_grandparents' },
  { legacyKey: 'step_maternal_grandparents_address', fieldPrefix: 'step_maternal_grandparents' },
  { legacyKey: 'inlaw_address', fieldPrefix: 'inlaw' },
  { legacyKey: 'personal_address', fieldPrefix: 'personal' },
]

// Existing rows only have the single-line legacy blob — seed it into Street
// so nothing is lost, and staff can split it into City/State/Zip over time.
// Only applies when the structured fields are still completely empty.
function seedLegacyAddresses(row: StudentRow): StudentRow {
  const next = { ...row }
  for (const { legacyKey, fieldPrefix } of ADDRESS_GROUPS) {
    const structuredKeys = ['street', 'city', 'state', 'zip', 'country'].map(s => `${fieldPrefix}_${s}`)
    const hasStructured = structuredKeys.some(k => next[k])
    if (!hasStructured && next[legacyKey]) next[`${fieldPrefix}_street`] = next[legacyKey]
  }
  return next
}

// Paternal grandparents almost always share the student's own surname (it's
// the same family line), so pre-fill it as a real, editable starting value
// — not just a placeholder — to save re-typing it for the common case. No
// equivalent default exists for maternal grandparents, a different family
// line entirely, so that field starts genuinely blank.
function seedPaternalGrandparentsLastName(row: StudentRow): StudentRow {
  if (row.paternal_grandparents_last_name || !row.last_name) return row
  return { ...row, paternal_grandparents_last_name: row.last_name }
}

function formatAddress(g: { street?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string | null }): string {
  const cityLine = [g.city, [g.state, g.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [g.street, cityLine, g.country && g.country !== 'United States' ? g.country : null]
    .filter((s): s is string => !!s && s.trim() !== '')
    .join('\n')
}

// Recombines each structured address group back into its legacy single-line
// column right before save — see the ADDRESS_GROUPS comment above.
function withLegacyAddresses(row: StudentRow): StudentRow {
  const next = { ...row }
  for (const { legacyKey, fieldPrefix } of ADDRESS_GROUPS) {
    const combined = formatAddress({
      street: next[`${fieldPrefix}_street`],
      city: next[`${fieldPrefix}_city`],
      state: next[`${fieldPrefix}_state`],
      zip: next[`${fieldPrefix}_zip`],
      country: next[`${fieldPrefix}_country`],
    })
    if (combined) next[legacyKey] = combined
  }
  return next
}

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

// Street/City/State/Zip/Country for one address group. When
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set, the Street input becomes a live
// Google Places Autocomplete box — picking a suggestion fills in the rest.
// Without a key it's just plain inputs; nothing breaks either way.
function AddressFields({
  label, fieldPrefix, form, set,
}: {
  label: string
  fieldPrefix: string
  form: StudentRow
  set: (k: string, v: string) => void
}) {
  const streetRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !streetRef.current) return
    let autocomplete: GoogleAutocomplete | undefined
    let cancelled = false

    loadGoogleMapsScript(GOOGLE_MAPS_API_KEY).then(() => {
      if (cancelled || !streetRef.current || !window.google) return
      autocomplete = new window.google.maps.places.Autocomplete(streetRef.current, {
        types: ['address'],
        fields: ['address_components'],
      })
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete!.getPlace()
        const comp = (type: string) => place.address_components?.find(c => c.types.includes(type))
        const streetNumber = comp('street_number')?.long_name ?? ''
        const route = comp('route')?.long_name ?? ''
        const city = comp('locality')?.long_name ?? comp('postal_town')?.long_name ?? ''
        const state = comp('administrative_area_level_1')?.short_name ?? ''
        const zip = comp('postal_code')?.long_name ?? ''
        const country = comp('country')?.long_name ?? ''
        set(`${fieldPrefix}_street`, [streetNumber, route].filter(Boolean).join(' '))
        if (city) set(`${fieldPrefix}_city`, city)
        if (state) set(`${fieldPrefix}_state`, state)
        if (zip) set(`${fieldPrefix}_zip`, zip)
        if (country) set(`${fieldPrefix}_country`, country)
      })
    }).catch(() => {})

    return () => { cancelled = true }
    // fieldPrefix identifies which input this effect is bound to; set is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldPrefix])

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-500">{label}</label>
      <input
        ref={streetRef}
        value={form[`${fieldPrefix}_street`] ?? ''}
        onChange={e => set(`${fieldPrefix}_street`, e.target.value)}
        placeholder={GOOGLE_MAPS_API_KEY ? 'Start typing an address…' : 'Street address'}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={form[`${fieldPrefix}_city`] ?? ''}
          onChange={e => set(`${fieldPrefix}_city`, e.target.value)}
          placeholder="City"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          value={form[`${fieldPrefix}_state`] ?? ''}
          onChange={e => set(`${fieldPrefix}_state`, e.target.value)}
          placeholder="State"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          value={form[`${fieldPrefix}_zip`] ?? ''}
          onChange={e => set(`${fieldPrefix}_zip`, e.target.value)}
          placeholder="Zip Code"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          value={form[`${fieldPrefix}_country`] ?? 'United States'}
          onChange={e => set(`${fieldPrefix}_country`, e.target.value)}
          placeholder="Country"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  )
}

// A last name is null/blank unless it differs from the student's — covers
// divorced parents (mother remarried/reverted) and grandmothers who don't
// share the family surname, without cluttering the common case. Defined at
// module scope (not inside StudentEditForm) so its identity is stable across
// renders — an inline component would remount on every keystroke and drop
// focus out of the text input.
function LastNameOverride({
  label, value, lastName, sameAsLabel = 'student', onChange,
}: {
  label: string
  value: string
  lastName: string
  // What `lastName` represents, for the dropdown's own wording — "student"
  // for Mother Last Name, "the grandparents' last name" for a grandmother's
  // personal override (see GrandparentSection, where `lastName` is the
  // grandparents' own Last Name field, not the student's).
  sameAsLabel?: string
  onChange: (v: string) => void
}) {
  // explicitMode tracks the user's actual dropdown choice separately from
  // `value`, so picking "Same as X" sticks even though it also means
  // value === '' — otherwise that'd be indistinguishable from "never set".
  const [explicitMode, setExplicitMode] = useState<'same' | 'different' | null>(null)
  const mode = explicitMode ?? (value ? 'different' : 'same')
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <select
        value={mode}
        onChange={e => {
          const next = e.target.value as 'same' | 'different'
          setExplicitMode(next)
          if (next === 'same') onChange('')
        }}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="same">Same as {sameAsLabel}{lastName ? ` (${lastName})` : ''}</option>
        <option value="different">Different last name</option>
      </select>
      {mode === 'different' && (
        <NameInput
          value={value}
          onChange={onChange}
          placeholder="Last name"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  )
}

const FAMILY_MARITAL_STATUS_OPTIONS = ['Married', 'Separated', 'Divorced', 'Widowed']

// Same "stable identity" reasoning as LastNameOverride above — defined at
// module scope so it doesn't remount on every render.
function FamilyMaritalStatusSelect({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <select
        value={value || 'Married'}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {FAMILY_MARITAL_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

// Shown per-parent once Parents Marital Status is anything other than
// Married — each parent may independently still be single or have
// remarried, which is what determines whether a Step Grandparents section
// appears below (see GrandparentSection usage further down).
function RemarriageFields({
  parentLabel, spouseLabel, statusValue, firstName, lastName, onStatusChange, onFirstNameChange, onLastNameChange,
}: {
  parentLabel: string
  spouseLabel: string
  statusValue: string
  firstName: string
  lastName: string
  onStatusChange: (v: string) => void
  onFirstNameChange: (v: string) => void
  onLastNameChange: (v: string) => void
}) {
  const remarried = (statusValue || 'Single') === 'Remarried'
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{parentLabel}</label>
      <select
        value={statusValue || 'Single'}
        onChange={e => onStatusChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="Single">Single</option>
        <option value="Remarried">Remarried</option>
      </select>
      {remarried && (
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          <NameInput
            value={firstName}
            onChange={onFirstNameChange}
            placeholder={`${spouseLabel} First Name`}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <NameInput
            value={lastName}
            onChange={onLastNameChange}
            placeholder={`${spouseLabel} Last Name`}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  )
}

// Renders one grandparents panel (name/cell/email fields + address + home
// phone). Used for the two blood-relation panels (paternal/maternal, which
// also get the last-name-override and marital-status extras) and the two
// step-grandparent panels that appear when a parent has remarried.
function GrandparentSection({
  title, prefix, form, set, showLastNameOverride, maritalStatusKey,
}: {
  title: string
  prefix: string
  form: StudentRow
  set: (k: string, v: string) => void
  showLastNameOverride?: boolean
  maritalStatusKey?: string
}) {
  const grandparentsLastName = form[`${prefix}_grandparents_last_name`] ?? ''
  // Step grandparent groups have no marital status tracked (always presumed
  // a couple), so only the blood paternal/maternal groups ever split into
  // separate per-person titles — same reasoning as the Parents section above.
  const notMarried = !!maritalStatusKey && !!form[maritalStatusKey] && form[maritalStatusKey] !== 'Married'
  return (
    <div className="border-t border-slate-100 pt-4">
      <h2 className="font-semibold text-slate-900 mb-3">{title}</h2>
      <div className="space-y-3">
        {notMarried ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Grandfather&apos;s Title</label>
              <SmartFormField
                fieldKey={`${prefix}_grandfather_title`}
                value={form[`${prefix}_grandfather_title`] ?? ''}
                onChange={v => set(`${prefix}_grandfather_title`, v)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Grandmother&apos;s Title</label>
              <SmartFormField
                fieldKey={`${prefix}_grandmother_title`}
                value={form[`${prefix}_grandmother_title`] ?? ''}
                onChange={v => set(`${prefix}_grandmother_title`, v)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Title</label>
            <SmartFormField
              fieldKey={`${prefix}_grandparents_title`}
              value={form[`${prefix}_grandparents_title`] ?? ''}
              onChange={v => set(`${prefix}_grandparents_title`, v)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
        {GRANDPARENT_NAME_FIELDS(prefix).map(([label, key, type]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
            <SmartFormField
              fieldKey={key}
              type={type}
              value={form[key] ?? ''}
              onChange={v => set(key, v)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}
        {/* The grandparents' own family surname — same idea as the student's
            First/Last Name split. This is the baseline the grandmother
            override below compares against, not the student's last name,
            since e.g. maternal grandparents' surname is a different family
            line entirely and was never expected to match the student's. */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Last Name</label>
          <NameInput
            value={grandparentsLastName}
            onChange={v => set(`${prefix}_grandparents_last_name`, v)}
            placeholder={prefix === 'paternal' && form.last_name ? `e.g. ${form.last_name}` : 'Family last name'}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {GRANDPARENT_CONTACT_FIELDS(prefix).map(([label, key, type]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
            <SmartFormField
              fieldKey={key}
              type={type}
              value={form[key] ?? ''}
              onChange={v => set(key, v)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}
        {showLastNameOverride && (
          <LastNameOverride
            label="Grandmother Last Name"
            value={form[`${prefix}_grandmother_last_name`] ?? ''}
            lastName={grandparentsLastName}
            sameAsLabel="the grandparents' last name"
            onChange={v => set(`${prefix}_grandmother_last_name`, v)}
          />
        )}
        {maritalStatusKey && (
          <FamilyMaritalStatusSelect
            label="Marital Status"
            value={form[maritalStatusKey] ?? ''}
            onChange={v => set(maritalStatusKey, v)}
          />
        )}
        <AddressFields label="Address" fieldPrefix={`${prefix}_grandparents`} form={form} set={set} />
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Home Number</label>
          <PhoneInput
            value={form[`${prefix}_grandparents_home_phone`] ?? ''}
            onChange={v => set(`${prefix}_grandparents_home_phone`, v)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  )
}

export default function StudentEditForm({ student }: { student?: StudentRow | null }) {
  const router = useRouter()
  const supabase = createClient()
  const isNew = !student?.id
  // New students get a $250 registration fee queued up automatically — managed
  // (paid/waived) from the student's Tuition page, not from this form.
  const [form, setForm] = useState<StudentRow>(() =>
    student
      ? seedPaternalGrandparentsLastName(seedLegacyAddresses(student))
      : { status: 'active', registration_fee_status: 'pending', registration_fee_amount: '250' }
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // "Upcoming Semester" isn't a real stored status — the DB status stays
  // 'active' the whole time (see lib/semesters.ts), and the "Upcoming" /
  // "Pending" display is computed live from came_semester so it flips to
  // Active on its own once that semester starts, with no cron job needed.
  // This dropdown just gives that state a visible, selectable name.
  //
  // upcomingIntent tracks "the user explicitly chose Upcoming Semester in
  // this session" separately from the live came_semester computation below,
  // so the dropdown doesn't snap back to "Active" while they still haven't
  // picked a qualifying future semester yet.
  const [upcomingIntent, setUpcomingIntent] = useState(false)
  const rawStatus = form.status ?? 'active'
  const statusSelectValue =
    upcomingIntent || (rawStatus === 'active' && isSemesterUpcoming(form.came_semester)) ? 'upcoming' : rawStatus

  function selectStatus(v: string) {
    setUpcomingIntent(v === 'upcoming')
    set('status', v === 'upcoming' ? 'active' : v)
  }

  // Step-grandparent panels only make sense once the parents aren't
  // Married, and only for whichever parent has actually remarried.
  const parentsNotMarried = !!form.parents_marital_status && form.parents_marital_status !== 'Married'
  const fatherRemarried = parentsNotMarried && (form.father_current_status || 'Single') === 'Remarried'
  const motherRemarried = parentsNotMarried && (form.mother_current_status || 'Single') === 'Remarried'

  // grade_level is the grade the student STARTED at (paired with
  // came_semester) — computedGrade is what they're actually in now,
  // advancing on its own each academic year. Shown as a hint only; the
  // stored value never changes on its own.
  const computedGrade = currentGradeLevel(form.grade_level, form.came_semester)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess(false)

    const withAddresses = withLegacyAddresses(form)

    if (isNew) {
      const payload = Object.fromEntries(Object.entries(withAddresses).map(([k, v]) => [k, v === '' ? null : v]))
      const { data, error } = await supabase.from('students').insert([payload]).select('id').single()
      if (error) { setError(error.message); setLoading(false); return }
      // Best-effort — Sola client sync shouldn't block the student record from being created.
      fetch('/api/sola/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'student', id: data.id }),
      }).catch(err => console.warn('Sola customer sync failed:', err))
      router.push(`/admin/students/${data.id}`)
      return
    }

    const { error } = await supabase.from('students').update(withAddresses).eq('id', student!.id)
    if (error) { setError(error.message) } else { setSuccess(true); router.refresh() }

    // Phone Charge is billed via a real Sola recurring schedule that runs on
    // its own clock — "until graduated" only actually stops it if graduating
    // a student cancels that schedule here. Best-effort: the save above
    // already succeeded, so a cancellation hiccup shouldn't block or fail it
    // — worst case, staff needs to notice and stop it manually on the
    // Tuition page (the panel still exposes a Stop button either way).
    if (!error && form.status === 'graduated') {
      const { data: activeSchedules } = await supabase.from('payment_schedules')
        .select('id').eq('student_id', student!.id).eq('purpose', 'phone_charge').eq('status', 'active')
      for (const sched of activeSchedules ?? []) {
        fetch(`/api/sola/schedule?id=${sched.id}`, { method: 'DELETE' }).catch(err => console.warn('Failed to auto-cancel Phone Charge on graduation:', err))
      }
    }

    setLoading(false)
  }

  async function handleDelete() {
    if (!student?.id || !confirm('Delete this student? This cannot be undone.')) return
    await supabase.from('students').delete().eq('id', student.id)
    router.push('/admin/students')
  }

  return (
    <form onSubmit={handleSave} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-5">

      {/* Basic info */}
      <div>
        <h2 className="font-semibold text-slate-900 mb-3">Student Info</h2>
        <div className="space-y-3">
          {BASIC_FIELDS.map(({ label, key, type, required }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
              <SmartFormField
                fieldKey={key}
                type={type}
                required={required}
                value={form[key] ?? ''}
                onChange={v => set(key, v)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Starting Grade Level</label>
            <select
              value={form.grade_level ?? ''}
              onChange={e => set('grade_level', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select —</option>
              {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              {computedGrade && computedGrade !== form.grade_level
                ? <>Automatically advances each academic year — currently showing as <strong className="text-slate-600">{computedGrade}</strong> throughout the CRM.</>
                : 'Automatically advances one grade each academic year — no need to update this manually.'}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <select
              value={statusSelectValue}
              onChange={e => selectStatus(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="upcoming">Upcoming Semester</option>
              <option value="inactive">Inactive</option>
              <option value="graduated">Graduated</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
            {statusSelectValue === 'upcoming' && (
              <p className="text-xs text-amber-600 mt-1">
                {isSemesterUpcoming(form.came_semester)
                  ? <>Shown as &quot;Upcoming&quot; until {form.came_semester} starts, then automatically becomes Active — no need to change anything manually. Tuition, registration fees, building fund, and donations can all be added now, same as any other student.</>
                  : <>Pick the semester they&apos;re starting below — once it&apos;s a future semester, they&apos;ll show as &quot;Upcoming&quot; and switch to Active automatically when it begins.</>}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Starting / Came Semester</label>
            <select
              value={form.came_semester ?? ''}
              onChange={e => set('came_semester', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select semester —</option>
              {form.came_semester && !ALL_SEMESTER_VALUES.has(form.came_semester) && (
                <option value={form.came_semester}>{form.came_semester} (legacy)</option>
              )}
              {SCHOOL_YEAR_SEMESTERS.map(({ year, semesters }) => (
                <optgroup key={year} label={year}>
                  {semesters.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Sem 1: Elul → post-Yom Kippur · Sem 2: Cheshvan → 1 Nissan · Sem 3: Iyar → 1 Av
            </p>
          </div>
        </div>
      </div>

      {/* Contact — family / parents home */}
      <div className="border-t border-slate-100 pt-4">
        <h2 className="font-semibold text-slate-900 mb-3">Family Home Contact</h2>
        <div className="space-y-3">
          <AddressFields label="Address" fieldPrefix="address" form={form} set={set} />
          {CONTACT_FIELDS.map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
              <SmartFormField
                fieldKey={key}
                value={form[key] ?? ''}
                onChange={v => set(key, v)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Parents */}
      <div className="border-t border-slate-100 pt-4">
        <h2 className="font-semibold text-slate-900 mb-3">Parents</h2>
        <div className="space-y-3">
          {parentsNotMarried ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Father&apos;s Title</label>
                <SmartFormField
                  fieldKey="father_title"
                  value={form.father_title ?? ''}
                  onChange={v => set('father_title', v)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Mother&apos;s Title</label>
                <SmartFormField
                  fieldKey="mother_title"
                  value={form.mother_title ?? ''}
                  onChange={v => set('mother_title', v)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Parents Title</label>
              <SmartFormField
                fieldKey="parents_title"
                value={form.parents_title ?? ''}
                onChange={v => set('parents_title', v)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
          {PARENT_FIELDS.map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
              <SmartFormField
                fieldKey={key}
                value={form[key] ?? ''}
                onChange={v => set(key, v)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
          <LastNameOverride
            label="Mother Last Name"
            value={form.mother_last_name ?? ''}
            lastName={form.last_name ?? ''}
            onChange={v => set('mother_last_name', v)}
          />
          <FamilyMaritalStatusSelect
            label="Parents Marital Status"
            value={form.parents_marital_status ?? ''}
            onChange={v => set('parents_marital_status', v)}
          />
          {parentsNotMarried && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-3">
              <RemarriageFields
                parentLabel="Father — Currently"
                spouseLabel="Stepmother"
                statusValue={form.father_current_status ?? ''}
                firstName={form.father_stepmother_first_name ?? ''}
                lastName={form.father_stepmother_last_name ?? ''}
                onStatusChange={v => set('father_current_status', v)}
                onFirstNameChange={v => set('father_stepmother_first_name', v)}
                onLastNameChange={v => set('father_stepmother_last_name', v)}
              />
              <RemarriageFields
                parentLabel="Mother — Currently"
                spouseLabel="Stepfather"
                statusValue={form.mother_current_status ?? ''}
                firstName={form.mother_stepfather_first_name ?? ''}
                lastName={form.mother_stepfather_last_name ?? ''}
                onStatusChange={v => set('mother_current_status', v)}
                onFirstNameChange={v => set('mother_stepfather_first_name', v)}
                onLastNameChange={v => set('mother_stepfather_last_name', v)}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Semester Left</label>
            <select
              value={form.semester_left ?? ''}
              onChange={e => set('semester_left', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select semester —</option>
              <option value="Still Active">Still Active</option>
              {form.semester_left && form.semester_left !== 'Still Active' && !ALL_SEMESTER_VALUES.has(form.semester_left) && (
                <option value={form.semester_left}>{form.semester_left} (legacy)</option>
              )}
              {SCHOOL_YEAR_SEMESTERS.map(({ year, semesters }) => (
                <optgroup key={year} label={year}>
                  {semesters.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      </div>

      <GrandparentSection
        title="Paternal Grandparents"
        prefix="paternal"
        form={form}
        set={set}
        showLastNameOverride
        maritalStatusKey="paternal_grandparents_marital_status"
      />

      {fatherRemarried && (
        <GrandparentSection
          title="Step Paternal Grandparents"
          prefix="step_paternal"
          form={form}
          set={set}
        />
      )}

      <GrandparentSection
        title="Maternal Grandparents"
        prefix="maternal"
        form={form}
        set={set}
        showLastNameOverride
        maritalStatusKey="maternal_grandparents_marital_status"
      />

      {motherRemarried && (
        <GrandparentSection
          title="Step Maternal Grandparents"
          prefix="step_maternal"
          form={form}
          set={set}
        />
      )}

      {/* Alumni / Personal Info */}
      <div className="border-t border-slate-100 pt-4">
        <h2 className="font-semibold text-slate-900 mb-1">Personal Info</h2>
        <p className="text-xs text-slate-400 mb-3">Alumni contact details separate from family.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Marital Status</label>
            <select
              value={form.marital_status ?? ''}
              onChange={e => set('marital_status', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select —</option>
              <option value="Single">Single</option>
              <option value="Married">Married</option>
              <option value="Divorced">Divorced</option>
              <option value="Widowed">Widowed</option>
              <option value="Separated">Separated</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Personal Phone</label>
            <PhoneInput
              value={form.personal_phone ?? ''}
              onChange={v => set('personal_phone', v)}
              placeholder="Graduate's own phone number"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <AddressFields label="Personal Address" fieldPrefix="personal" form={form} set={set} />
        </div>
      </div>

      {/* Spouse info — shown only when Married */}
      {form.marital_status === 'Married' && (
        <>
          <div className="border-t border-pink-100 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-semibold text-slate-900">Spouse</h2>
              <span className="text-xs text-pink-400 font-medium bg-pink-50 px-2 py-0.5 rounded-full">Married</span>
            </div>
            <div className="space-y-3">
              {([
                ['First Name', 'spouse_first_name', 'text'],
                ['Last Name',  'spouse_last_name',  'text'],
                ['Phone',      'spouse_phone',      'tel'],
                ['Email',      'spouse_email',      'email'],
              ] as const).map(([label, key, type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                  <SmartFormField
                    fieldKey={key}
                    type={type}
                    value={form[key] ?? ''}
                    onChange={v => set(key, v)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-pink-100 pt-4">
            <h2 className="font-semibold text-slate-900 mb-1">In-Laws <span className="text-xs font-normal text-slate-400">(Spouse&apos;s Parents)</span></h2>
            <div className="space-y-3">
              {([
                ['Family Title / Name',   'inlaw_parents_title', 'text'],
                ['Father Name',           'inlaw_father_name',   'text'],
                ['Father Cell',           'inlaw_father_cell',   'tel'],
                ['Father Email',          'inlaw_father_email',  'email'],
                ['Mother Name',           'inlaw_mother_name',   'text'],
                ['Mother Cell',           'inlaw_mother_cell',   'tel'],
                ['Mother Email',          'inlaw_mother_email',  'email'],
              ] as const).map(([label, key, type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                  <SmartFormField
                    fieldKey={key}
                    type={type}
                    value={form[key] ?? ''}
                    onChange={v => set(key, v)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              <AddressFields label="In-Laws Address" fieldPrefix="inlaw" form={form} set={set} />
            </div>
          </div>
        </>
      )}

      {/* Health */}
      <div className="border-t border-slate-100 pt-4">
        <h2 className="font-semibold text-slate-900 mb-3">Health</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Allergies</label>
            <textarea
              value={form.allergies ?? ''}
              onChange={e => set('allergies', e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Medical Notes</label>
            <textarea
              value={form.medical_notes ?? ''}
              onChange={e => set('medical_notes', e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="border-t border-slate-100 pt-4">
        <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
        <textarea
          value={form.notes ?? ''}
          onChange={e => set('notes', e.target.value)}
          rows={3}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {error && <p className="text-red-600 text-xs">{error}</p>}
      {success && <p className="text-green-600 text-xs">Saved.</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors">
          {loading ? (isNew ? 'Creating…' : 'Saving…') : (isNew ? 'Create Student' : 'Save')}
        </button>
        {!isNew && (
          <button type="button" onClick={handleDelete}
            className="text-red-600 hover:bg-red-50 text-xs font-medium px-4 py-2 rounded-lg border border-red-200 transition">
            Delete
          </button>
        )}
      </div>
    </form>
  )
}
