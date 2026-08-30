'use client'

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  RefreshCw, ChevronDown, ChevronRight, Search, Check, Ban, Undo2,
  AlertCircle, ExternalLink, Loader2, UserPlus, HelpCircle, PartyPopper, X,
} from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

// ── Types ────────────────────────────────────────────────────────────────────

type MatchStatus = 'matched' | 'needs_review' | 'unmatched' | 'not_a_student' | 'merged'
type DonorMatchStatus = 'matched' | 'needs_review' | 'unmatched' | 'not_a_donor'

type SyncCustomer = {
  id: string
  sola_customer_id: string
  sola_customer_number: string | null
  bill_first_name: string | null
  bill_last_name: string | null
  email: string | null
  match_status: MatchStatus
  matched_student_id: string | null
  match_method: string | null
  donor_match_status: DonorMatchStatus
  matched_donor_id: string | null
  donor_match_method: string | null
  suggested_donor_student_id: string | null
  last_synced_at: string
  default_purpose: DefaultPurpose | null
  default_donation_category: DonationCategory | null
}

type SyncSchedule = {
  id: string
  sola_sync_customer_id: string
  sola_schedule_id: string
  description: string | null
  amount: number | null
  interval_type: string | null
  interval_count: number | null
  total_payments: number | null
  payments_processed: number | null
  next_scheduled_date: string | null
  default_purpose: DefaultPurpose | null
  default_donation_category: DonationCategory | null
  linked_payment_schedule_id: string | null
}

type ImportStatus = 'pending' | 'duplicate' | 'imported' | 'skipped' | 'needs_review'
type FeeType = 'tuition' | 'building_fund' | 'registration_fee'
type DonationCategory = 'monthly_recurring' | 'one_time' | 'event'
type ChargeKind = 'tuition' | 'donation' | 'ambiguous'
type DefaultPurpose = 'tuition' | 'building_fund' | 'registration_fee' | 'donation'

type SyncPayment = {
  id: string
  sola_sync_customer_id: string
  sola_sync_schedule_id: string | null
  sola_transaction_id: string
  amount: number | null
  transaction_date: string | null
  gateway_status: string | null
  charge_kind: ChargeKind
  suggested_fee_type: FeeType | null
  suggested_donation_category: DonationCategory | null
  import_status: ImportStatus
  tuition_payment_id: string | null
  donation_id: string | null
  duplicate_of_donation_id: string | null
  duplicate_of_tuition_payment_id: string | null
}

type Student = { id: string; first_name: string; last_name: string }
type Donor = { id: string; name: string }
type EventOption = { id: string; name: string }
type TuitionPlan = { id: string; student_id: string; academic_year: string | null; status: string | null }
type ExistingTuitionPayment = { id: string; student_id: string; amount: number; payment_date: string | null; payment_type: string | null }
type ExistingDonation = { id: string; donor_id: string; amount: number; donation_date: string }

type Decision = { kind: ChargeKind | null; feeType: FeeType; planId: string; category: DonationCategory; eventId: string }

const FILTERS: { key: MatchStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'matched', label: 'Matched' },
  { key: 'merged', label: 'Merged' },
  { key: 'not_a_student', label: 'Not a Student' },
]

const statusBadge: Record<string, string> = {
  matched: 'bg-blue-100 text-blue-700',
  needs_review: 'bg-amber-100 text-amber-700',
  unmatched: 'bg-slate-100 text-slate-600',
  not_a_student: 'bg-slate-100 text-slate-400',
  not_a_donor: 'bg-slate-100 text-slate-400',
  merged: 'bg-green-100 text-green-700',
}
const statusLabel: Record<string, string> = {
  matched: 'Matched', needs_review: 'Needs Review', unmatched: 'Unmatched',
  not_a_student: 'Not a Student', not_a_donor: 'Not a Donor', merged: 'Merged',
}

function feeTypeLabel(t: string | null) {
  if (t === 'building_fund') return 'Building Fund'
  if (t === 'registration_fee') return 'Registration Fee'
  return 'Tuition'
}
function categoryLabel(c: string | null) {
  if (c === 'monthly_recurring') return 'Monthly Recurring'
  if (c === 'event') return 'Event'
  if (c === 'one_time') return 'One-Time'
  return '—'
}
function studentName(s: Student | undefined) {
  return s ? [s.first_name, s.last_name].filter(Boolean).join(' ') : '—'
}
function latestPlan(studentId: string, plans: TuitionPlan[]): TuitionPlan | null {
  const mine = plans.filter(p => p.student_id === studentId)
  if (!mine.length) return null
  return [...mine].sort((a, b) => {
    const yearCmp = (b.academic_year || '').localeCompare(a.academic_year || '')
    if (yearCmp !== 0) return yearCmp
    return (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
  })[0]
}

// ── Search-and-link pickers ──────────────────────────────────────────────────

function EntityPicker<T extends { id: string }>({ items, label, placeholder, busy, onPick }: {
  items: T[]; label: (item: T) => string; placeholder: string; busy: boolean; onPick: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return items.filter(i => label(i).toLowerCase().includes(q)).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- label is a stable closure per call site, not state
  }, [query, items])

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={placeholder} disabled={busy}
          className="w-56 border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
      </div>
      {matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          {matches.map(item => (
            <button key={item.id} type="button" onClick={() => { onPick(item.id); setQuery('') }}
              className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50 transition-colors">
              {label(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SolaSyncPage() {
  const supabase = createClient()

  const [syncCustomers, setSyncCustomers] = useState<SyncCustomer[]>([])
  const [syncSchedules, setSyncSchedules] = useState<SyncSchedule[]>([])
  const [syncPayments, setSyncPayments] = useState<SyncPayment[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [donors, setDonors] = useState<Donor[]>([])
  const [events, setEvents] = useState<EventOption[]>([])
  const [tuitionPlans, setTuitionPlans] = useState<TuitionPlan[]>([])
  const [existingPayments, setExistingPayments] = useState<ExistingTuitionPayment[]>([])
  const [existingDonations, setExistingDonations] = useState<ExistingDonation[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [filter, setFilter] = useState<MatchStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [selectedForBulk, setSelectedForBulk] = useState<Set<string>>(new Set())
  const [bulkEventId, setBulkEventId] = useState('')
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: sc }, { data: ss }, { data: sp }, { data: st }, { data: dn }, { data: ev }, { data: tp }] = await Promise.all([
      supabase.from('sola_sync_customers').select('*').order('bill_last_name'),
      supabase.from('sola_sync_schedules').select('*'),
      supabase.from('sola_sync_payments').select('*').order('transaction_date'),
      supabase.from('students').select('id,first_name,last_name').order('last_name'),
      supabase.from('donors').select('id,name').order('name'),
      supabase.from('events').select('id,name').order('event_date', { ascending: false }),
      supabase.from('tuition_plans').select('id,student_id,academic_year,status'),
    ])
    setSyncCustomers((sc ?? []) as SyncCustomer[])
    setSyncSchedules(ss ?? [])
    setSyncPayments((sp ?? []) as SyncPayment[])
    setStudents(st ?? [])
    setDonors(dn ?? [])
    setEvents(ev ?? [])
    setTuitionPlans(tp ?? [])

    const matchedStudentIds = (sc ?? []).map(c => c.matched_student_id).filter((id): id is string => !!id)
    // Embedded on students rather than queried directly against
    // tuition_payments — some school network filters block any direct
    // request to that resource outright (confirmed live on the student
    // tuition page).
    setExistingPayments(matchedStudentIds.length
      ? ((await supabase.from('students').select('id, tuition_payments(id,amount,payment_date,payment_type)').in('id', matchedStudentIds)).data ?? [])
          .flatMap(s => ((s.tuition_payments ?? []) as { id: string; amount: number; payment_date: string | null; payment_type: string | null }[])
            .map(p => ({ student_id: s.id, id: p.id, amount: p.amount, payment_date: p.payment_date, payment_type: p.payment_type })))
      : [])
    const matchedDonorIds = (sc ?? []).map(c => c.matched_donor_id).filter((id): id is string => !!id)
    setExistingDonations(matchedDonorIds.length
      ? (await supabase.from('donations').select('id,donor_id,amount,donation_date').in('donor_id', matchedDonorIds)).data ?? []
      : [])
    setLoading(false)
  }, [supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
  useEffect(() => { load() }, [load])

  const summary = useMemo(() => {
    const counts: Record<MatchStatus, number> = { matched: 0, needs_review: 0, unmatched: 0, not_a_student: 0, merged: 0 }
    for (const c of syncCustomers) counts[c.match_status]++
    const donorCounts: Record<DonorMatchStatus, number> = { matched: 0, needs_review: 0, unmatched: 0, not_a_donor: 0 }
    for (const c of syncCustomers) donorCounts[c.donor_match_status]++
    return {
      ...counts, donorCounts,
      pendingTuition: syncPayments.filter(p => p.import_status === 'pending' && p.charge_kind === 'tuition').length,
      pendingDonations: syncPayments.filter(p => p.import_status === 'pending' && p.charge_kind === 'donation').length,
      needsReview: syncPayments.filter(p => p.import_status === 'needs_review').length,
    }
  }, [syncCustomers, syncPayments])

  const filteredByStatus = filter === 'all' ? syncCustomers : syncCustomers.filter(c => c.match_status === filter)
  const searchQuery = search.trim().toLowerCase()
  const visibleCustomers = searchQuery
    ? filteredByStatus.filter(c => {
        const matchedStudent = c.matched_student_id ? students.find(s => s.id === c.matched_student_id) : undefined
        const matchedDonor = c.matched_donor_id ? donors.find(d => d.id === c.matched_donor_id) : undefined
        const haystack = [
          c.bill_first_name, c.bill_last_name, c.sola_customer_id, c.sola_customer_number, c.email,
          matchedStudent ? studentName(matchedStudent) : '', matchedDonor?.name,
        ].filter(Boolean).join(' ').toLowerCase()
        return haystack.includes(searchQuery)
      })
    : filteredByStatus

  async function runSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/sola/sync/run', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sync failed.')
      setSyncResult(`Synced ${json.customersSeen} Sola customers (${json.newCustomers} new), ${json.newPayments} new payment${json.newPayments === 1 ? '' : 's'} staged.`)
      await load()
    } catch (e) {
      setSyncResult(e instanceof Error ? e.message : 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  async function studentAction(syncCustomerId: string, action: 'link' | 'confirm' | 'dismiss' | 'reset', studentId?: string) {
    setBusyId(syncCustomerId)
    try {
      const res = await fetch('/api/sola/sync/customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncCustomerId, action, studentId }),
      })
      if (!res.ok) { const j = await res.json().catch(() => null); alert(j?.error || 'Action failed.'); return }
      await load()
    } finally { setBusyId(null) }
  }

  async function donorAction(syncCustomerId: string, action: 'link' | 'confirm' | 'dismiss' | 'reset' | 'create_new', donorId?: string) {
    setBusyId(syncCustomerId)
    try {
      const res = await fetch('/api/sola/sync/donor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncCustomerId, action, donorId }),
      })
      if (!res.ok) { const j = await res.json().catch(() => null); alert(j?.error || 'Action failed.'); return }
      await load()
    } finally { setBusyId(null) }
  }

  // Sets the default categorization Sola Sync applies to newly-staged
  // payments for this customer/schedule going forward — never touches
  // payments already staged (see classificationFromDefault in
  // app/api/sola/sync/run/route.ts).
  async function setDefault(target: 'customer' | 'schedule', id: string, purpose: DefaultPurpose | null, donationCategory?: DonationCategory | null) {
    setBusyId(id)
    try {
      const res = await fetch('/api/sola/sync/set-default', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, id, purpose, donationCategory }),
      })
      if (!res.ok) { const j = await res.json().catch(() => null); alert(j?.error || 'Failed to set default.'); return }
      await load()
    } finally { setBusyId(null) }
  }

  // "Track as Recurring": tags the live Sola schedule's Custom02 (for future
  // webhook attribution) and mirrors it into payment_schedules so it shows
  // on the student's tuition page like a CRM-created recurring plan.
  async function promoteSchedule(syncScheduleId: string) {
    setBusyId(syncScheduleId)
    try {
      const res = await fetch('/api/sola/sync/promote-schedule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncScheduleId }),
      })
      if (!res.ok) { const j = await res.json().catch(() => null); alert(j?.error || 'Failed to track as recurring.'); return }
      await load()
    } finally { setBusyId(null) }
  }

  function getDecision(payment: SyncPayment, studentId: string | null): Decision {
    const existing = decisions[payment.id]
    if (existing) return existing
    const plan = studentId ? latestPlan(studentId, tuitionPlans) : null
    return {
      kind: payment.charge_kind === 'ambiguous' ? null : payment.charge_kind,
      feeType: payment.suggested_fee_type ?? 'tuition',
      planId: plan?.id ?? '',
      category: payment.suggested_donation_category ?? 'one_time',
      eventId: '',
    }
  }
  function setDecision(paymentId: string, patch: Partial<Decision>, fallback: Decision) {
    setDecisions(d => ({ ...d, [paymentId]: { ...(d[paymentId] ?? fallback), ...patch } }))
  }

  async function importPayments(syncCustomerId: string, customer: SyncCustomer, payments: SyncPayment[]) {
    const pending = payments.filter(p => p.import_status === 'pending')
    if (!pending.length) return
    const decisionPayload: Record<string, unknown>[] = []
    let unresolved = 0
    for (const p of pending) {
      const d = getDecision(p, customer.matched_student_id)
      if (!d.kind) { unresolved++; continue }
      decisionPayload.push(d.kind === 'tuition'
        ? { syncPaymentId: p.id, kind: 'tuition', feeType: d.feeType, tuitionPlanId: d.feeType === 'registration_fee' ? null : (d.planId || null) }
        : { syncPaymentId: p.id, kind: 'donation', category: d.category, eventId: d.category === 'event' ? (d.eventId || null) : null })
    }
    if (!decisionPayload.length) {
      if (unresolved) alert(`${unresolved} payment(s) still need Tuition/Donation classified before they can be imported.`)
      return
    }
    setBusyId(syncCustomerId)
    try {
      const res = await fetch('/api/sola/sync/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncCustomerId, decisions: decisionPayload }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error || 'Import failed.'); return }
      const results = json.results as { status: string; reason?: string }[]
      const notable = results.filter(r => r.status !== 'imported' && r.reason)
      const lines = [...notable.map(r => `• ${r.reason}`), unresolved ? `• ${unresolved} payment(s) still need Tuition/Donation classified.` : null].filter(Boolean)
      if (lines.length) alert(`${lines.length} of ${results.length + (unresolved ? 1 : 0)} item(s) needed attention:\n${lines.join('\n')}`)
      setSelectedForBulk(new Set())
      await load()
    } finally { setBusyId(null) }
  }

  async function resolveDuplicate(syncPaymentId: string, resolution: 'same' | 'separate' | 'correction') {
    setResolvingId(syncPaymentId)
    try {
      const res = await fetch('/api/sola/sync/resolve-duplicate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncPaymentId, resolution }),
      })
      if (!res.ok) { const j = await res.json().catch(() => null); alert(j?.error || 'Failed to resolve.'); return }
      await load()
    } finally { setResolvingId(null) }
  }

  function applyBulkEvent(customerPayments: SyncPayment[], studentId: string | null) {
    if (!bulkEventId) return
    for (const p of customerPayments) {
      if (!selectedForBulk.has(p.id)) continue
      const d = getDecision(p, studentId)
      setDecision(p.id, { kind: 'donation', category: 'event', eventId: bulkEventId }, d)
    }
    setSelectedForBulk(new Set())
    setBulkEventId('')
  }

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sola Sync</h1>
          <p className="text-sm text-slate-500 mt-1">
            Pull existing customer/payment history from Sola, match it to students or donors, and review before importing.
          </p>
        </div>
        <button onClick={runSync} disabled={syncing}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>

      {syncResult && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg px-4 py-2.5">{syncResult}</div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2">
        <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          Sola only exposes transactions tied to a recurring schedule — one-off charges made directly in Sola&apos;s
          portal may not appear here. Sola also has no fee-type field: whether a charge is tuition or a donation
          (and which sub-category) is suggested from its schedule&apos;s description and amount — review and correct
          before importing. Possible-duplicate donations are never auto-imported; they always wait for you to
          confirm same / separate / correction below.
        </span>
      </div>

      {/* Running summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Matched" value={summary.matched} />
        <SummaryCard label="Needs Review" value={summary.needs_review} />
        <SummaryCard label="Unmatched" value={summary.unmatched} />
        <SummaryCard label="Merged" value={summary.merged} accent="text-green-600" />
        <SummaryCard label="Tuition Awaiting Import" value={summary.pendingTuition} accent="text-amber-600" />
        <SummaryCard label="Donations Awaiting Import" value={summary.pendingDonations} accent="text-amber-600" />
        <SummaryCard label="Possible Duplicates to Resolve" value={summary.needsReview} accent="text-red-600" />
        <SummaryCard label="Donors Matched" value={summary.donorCounts.matched} accent="text-violet-600" />
      </div>

      {/* Search + filter tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative w-full sm:w-80">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, Sola ID, matched student/donor…"
            className="w-full border border-slate-200 rounded-lg pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
              <X size={14} />
            </button>
          )}
        </div>
        {searchQuery && (
          <span className="text-xs text-slate-400">{visibleCustomers.length} result{visibleCustomers.length === 1 ? '' : 's'}</span>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${filter === f.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {visibleCustomers.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center text-sm text-slate-400">
          {syncCustomers.length === 0 ? 'No Sola customers synced yet — click "Sync Now" to pull from Sola.' : 'Nothing in this filter.'}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleCustomers.map(c => {
            const isExpanded = expandedId === c.id
            const customerSchedules = syncSchedules.filter(s => s.sola_sync_customer_id === c.id)
            const customerPayments = syncPayments.filter(p => p.sola_sync_customer_id === c.id)
            const pendingTuitionCount = customerPayments.filter(p => p.import_status === 'pending' && p.charge_kind === 'tuition').length
            const pendingDonationCount = customerPayments.filter(p => p.import_status === 'pending' && p.charge_kind === 'donation').length
            const needsClassification = customerPayments.filter(p => p.import_status === 'pending' && p.charge_kind === 'ambiguous').length
            const matchedStudent = c.matched_student_id ? students.find(s => s.id === c.matched_student_id) : undefined
            const matchedDonor = c.matched_donor_id ? donors.find(d => d.id === c.matched_donor_id) : undefined
            const suggestedStudent = c.suggested_donor_student_id ? students.find(s => s.id === c.suggested_donor_student_id) : undefined
            const isBusy = busyId === c.id

            return (
              <div key={c.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                  <button onClick={() => setExpandedId(isExpanded ? null : c.id)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-medium text-slate-800">
                      {[c.bill_first_name, c.bill_last_name].filter(Boolean).join(' ') || <span className="text-slate-400">(no name on file)</span>}
                    </p>
                    <p className="text-xs text-slate-400">{c.sola_customer_id}{c.email ? ` · ${c.email}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">Student</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[c.match_status]}`}>{statusLabel[c.match_status]}</span>
                    {matchedStudent && (
                      <Link href={`/admin/students/${matchedStudent.id}`} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                        {studentName(matchedStudent)} <ExternalLink size={11} />
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">Donor</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[c.donor_match_status]}`}>{statusLabel[c.donor_match_status]}</span>
                    {matchedDonor && (
                      <Link href={`/admin/donors/${matchedDonor.id}`} className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1">
                        {matchedDonor.name} <ExternalLink size={11} />
                      </Link>
                    )}
                  </div>
                  {pendingTuitionCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">{pendingTuitionCount} tuition pending</span>}
                  {pendingDonationCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">{pendingDonationCount} donation pending</span>}
                  {needsClassification > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium flex items-center gap-1"><HelpCircle size={11} />{needsClassification} needs kind</span>}
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 py-4 space-y-5">

                    {/* Student match panel */}
                    <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Student Match (Tuition)</p>
                        <div className="flex items-center gap-1.5">
                          {(c.match_status === 'unmatched' || c.match_status === 'needs_review') && (
                            <EntityPicker items={students} label={studentName as (s: Student) => string} placeholder="Search students to link…" busy={isBusy}
                              onPick={studentId => studentAction(c.id, 'link', studentId)} />
                          )}
                          {c.match_status === 'needs_review' && c.matched_student_id && (
                            <button disabled={isBusy} onClick={() => studentAction(c.id, 'confirm')}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1.5 rounded-lg hover:bg-blue-100 disabled:opacity-50"><Check size={13} />Confirm</button>
                          )}
                          {(c.match_status === 'unmatched' || c.match_status === 'needs_review') && (
                            <button disabled={isBusy} onClick={() => studentAction(c.id, 'dismiss')}
                              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 font-medium px-2 py-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-50"><Ban size={13} />Not a Student</button>
                          )}
                          {c.match_status === 'not_a_student' && (
                            <button disabled={isBusy} onClick={() => studentAction(c.id, 'reset')}
                              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 font-medium px-2 py-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-50"><Undo2 size={13} />Reset</button>
                          )}
                        </div>
                      </div>
                      {c.matched_student_id && (() => {
                        const mine = existingPayments.filter(p => p.student_id === c.matched_student_id)
                        return mine.length > 0 && (
                          <p className="text-xs text-blue-700 mt-1.5">
                            Already on file: {mine.length} tuition payment{mine.length === 1 ? '' : 's'} totaling {formatCurrency(mine.reduce((s, p) => s + Number(p.amount), 0))}.
                          </p>
                        )
                      })()}
                    </div>

                    {/* Donor match panel */}
                    <div className="bg-violet-50/50 border border-violet-100 rounded-lg p-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className="text-xs font-semibold text-violet-900 uppercase tracking-wide">Donor Match (Donations)</p>
                        <div className="flex items-center gap-1.5">
                          {(c.donor_match_status === 'unmatched' || c.donor_match_status === 'needs_review') && (
                            <>
                              <EntityPicker items={donors} label={(d: Donor) => d.name} placeholder="Search donors to link…" busy={isBusy}
                                onPick={donorId => donorAction(c.id, 'link', donorId)} />
                              <button disabled={isBusy} onClick={() => donorAction(c.id, 'create_new')}
                                className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium px-2 py-1.5 rounded-lg hover:bg-violet-100 disabled:opacity-50">
                                <UserPlus size={13} />New Contact from Sola
                              </button>
                            </>
                          )}
                          {c.donor_match_status === 'needs_review' && c.matched_donor_id && (
                            <button disabled={isBusy} onClick={() => donorAction(c.id, 'confirm')}
                              className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium px-2 py-1.5 rounded-lg hover:bg-violet-100 disabled:opacity-50"><Check size={13} />Confirm</button>
                          )}
                          {(c.donor_match_status === 'unmatched' || c.donor_match_status === 'needs_review') && (
                            <button disabled={isBusy} onClick={() => donorAction(c.id, 'dismiss')}
                              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 font-medium px-2 py-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-50"><Ban size={13} />Not a Donor</button>
                          )}
                          {c.donor_match_status === 'not_a_donor' && (
                            <button disabled={isBusy} onClick={() => donorAction(c.id, 'reset')}
                              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 font-medium px-2 py-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-50"><Undo2 size={13} />Reset</button>
                          )}
                        </div>
                      </div>
                      {c.donor_match_method === 'parent_of_student' && suggestedStudent && !c.matched_donor_id && (
                        <p className="text-xs text-violet-700 mt-1.5">
                          Looks like the parent of <strong>{studentName(suggestedStudent)}</strong> in Tuition — &quot;New Contact from Sola&quot; will create their donor record already linked to that student.
                        </p>
                      )}
                      {c.matched_donor_id && (() => {
                        const mine = existingDonations.filter(d => d.donor_id === c.matched_donor_id)
                        return mine.length > 0 && (
                          <p className="text-xs text-violet-700 mt-1.5">
                            Already on file: {mine.length} donation{mine.length === 1 ? '' : 's'} totaling {formatCurrency(mine.reduce((s, d) => s + Number(d.amount), 0))}.
                          </p>
                        )
                      })()}
                    </div>

                    {/* Sola-side schedules */}
                    {customerSchedules.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Sola Schedules</p>
                        <div className="space-y-1.5">
                          {customerSchedules.map(s => {
                            const scheduleBusy = busyId === s.id
                            return (
                              <div key={s.id} className="bg-slate-50 rounded-lg px-3 py-2 text-xs space-y-1.5">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                  <div>
                                    <span className="font-medium text-slate-700">{s.description || 'Schedule'}</span>
                                    <span className="text-slate-400 ml-2">{s.interval_type ? `${formatCurrency(Number(s.amount ?? 0))} / ${s.interval_type}` : formatCurrency(Number(s.amount ?? 0))}</span>
                                  </div>
                                  <span className="text-slate-500">
                                    {s.payments_processed ?? 0}{s.total_payments ? ` of ${s.total_payments}` : ''} paid
                                    {s.next_scheduled_date && ` · next ${new Date(s.next_scheduled_date + 'T00:00:00').toLocaleDateString()}`}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap pt-1.5 border-t border-slate-200/70">
                                  <span className="text-[10px] uppercase tracking-wide text-slate-400">Future charges on this schedule</span>
                                  <select disabled={scheduleBusy} value={s.default_purpose ?? ''}
                                    onChange={e => setDefault('schedule', s.id, (e.target.value || null) as DefaultPurpose | null, s.default_donation_category ?? 'monthly_recurring')}
                                    className="border border-slate-200 rounded px-1.5 py-0.5 text-xs bg-white disabled:opacity-50">
                                    <option value="">— classify automatically —</option>
                                    <option value="tuition">Tuition</option>
                                    <option value="building_fund">Building Fund</option>
                                    <option value="registration_fee">Registration Fee</option>
                                    <option value="donation">Donation</option>
                                  </select>
                                  {s.default_purpose === 'donation' && (
                                    <select disabled={scheduleBusy} value={s.default_donation_category ?? 'monthly_recurring'}
                                      onChange={e => setDefault('schedule', s.id, 'donation', e.target.value as DonationCategory)}
                                      className="border border-slate-200 rounded px-1.5 py-0.5 text-xs bg-white disabled:opacity-50">
                                      <option value="monthly_recurring">Monthly Recurring</option>
                                      <option value="one_time">One-Time</option>
                                      <option value="event">Event</option>
                                    </select>
                                  )}
                                  {s.linked_payment_schedule_id ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✓ Tracked as recurring</span>
                                  ) : s.default_purpose && s.default_purpose !== 'registration_fee' ? (
                                    <button disabled={scheduleBusy} onClick={() => promoteSchedule(s.id)}
                                      className="text-[10px] text-blue-600 hover:text-blue-700 font-medium px-1.5 py-0.5 rounded hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed">
                                      Track as Recurring
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Bulk event assignment toolbar */}
                    {selectedForBulk.size > 0 && (
                      <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                        <PartyPopper size={14} className="text-violet-600" />
                        <span className="text-xs text-violet-800 font-medium">{selectedForBulk.size} selected — assign to event:</span>
                        <select value={bulkEventId} onChange={e => setBulkEventId(e.target.value)}
                          className="border border-violet-200 rounded px-2 py-1 text-xs">
                          <option value="">— select event —</option>
                          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                        </select>
                        <button disabled={!bulkEventId} onClick={() => applyBulkEvent(customerPayments, c.matched_student_id)}
                          className="text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg font-medium">Apply</button>
                        <button onClick={() => setSelectedForBulk(new Set())} className="text-xs text-slate-400 hover:text-slate-600 ml-auto">Clear selection</button>
                      </div>
                    )}

                    {/* Payments */}
                    <div>
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sola Payments</p>
                          <span className="text-slate-300">·</span>
                          <span className="text-[10px] uppercase tracking-wide text-slate-400">Default for one-off charges (no schedule)</span>
                          <select disabled={isBusy} value={c.default_purpose ?? ''}
                            onChange={e => setDefault('customer', c.id, (e.target.value || null) as DefaultPurpose | null, c.default_donation_category ?? 'one_time')}
                            className="border border-slate-200 rounded px-1.5 py-0.5 text-xs disabled:opacity-50">
                            <option value="">— classify automatically —</option>
                            <option value="tuition">Tuition</option>
                            <option value="building_fund">Building Fund</option>
                            <option value="registration_fee">Registration Fee</option>
                            <option value="donation">Donation</option>
                          </select>
                          {c.default_purpose === 'donation' && (
                            <select disabled={isBusy} value={c.default_donation_category ?? 'one_time'}
                              onChange={e => setDefault('customer', c.id, 'donation', e.target.value as DonationCategory)}
                              className="border border-slate-200 rounded px-1.5 py-0.5 text-xs disabled:opacity-50">
                              <option value="one_time">One-Time</option>
                              <option value="monthly_recurring">Monthly Recurring</option>
                              <option value="event">Event</option>
                            </select>
                          )}
                        </div>
                        {(pendingTuitionCount + pendingDonationCount) > 0 && (
                          <button disabled={isBusy} onClick={() => importPayments(c.id, c, customerPayments)}
                            className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg font-medium transition-colors">
                            Import All Pending ({pendingTuitionCount + pendingDonationCount})
                          </button>
                        )}
                      </div>
                      {customerPayments.length === 0 ? (
                        <p className="text-xs text-slate-400">No transactions found for this customer.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-slate-100 text-slate-400">
                                <th className="pb-1.5 w-6" />
                                <th className="text-left pb-1.5 font-medium">Date</th>
                                <th className="text-right pb-1.5 font-medium">Amount</th>
                                <th className="text-left pb-1.5 font-medium pl-2">Kind</th>
                                <th className="text-left pb-1.5 font-medium pl-2">Details</th>
                                <th className="text-left pb-1.5 font-medium pl-2">Status</th>
                                <th className="pb-1.5 w-16" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {customerPayments.map(p => {
                                const studentId = c.matched_student_id
                                const decision = getDecision(p, studentId)
                                const studentPlanOptions = studentId ? tuitionPlans.filter(pl => pl.student_id === studentId) : []
                                const canEdit = p.import_status === 'pending'
                                const kindLocked = p.charge_kind !== 'ambiguous'
                                const canImportKind = decision.kind === 'tuition' ? c.match_status === 'matched' : decision.kind === 'donation' ? c.donor_match_status === 'matched' : false

                                return (
                                  <Fragment key={p.id}>
                                    <tr>
                                      <td className="py-1.5">
                                        {canEdit && decision.kind === 'donation' && (
                                          <input type="checkbox" checked={selectedForBulk.has(p.id)}
                                            onChange={e => setSelectedForBulk(prev => {
                                              const next = new Set(prev)
                                              if (e.target.checked) next.add(p.id); else next.delete(p.id)
                                              return next
                                            })} />
                                        )}
                                      </td>
                                      <td className="py-1.5 text-slate-600">{p.transaction_date ? new Date(p.transaction_date + 'T00:00:00').toLocaleDateString() : '—'}</td>
                                      <td className="py-1.5 text-right font-medium text-slate-800">{p.amount != null ? formatCurrency(Number(p.amount)) : <span className="text-red-500">unknown</span>}</td>
                                      <td className="py-1.5 pl-2">
                                        {canEdit && !kindLocked ? (
                                          <select value={decision.kind ?? ''} onChange={e => setDecision(p.id, { kind: (e.target.value || null) as ChargeKind | null }, decision)}
                                            className="border border-red-200 bg-red-50 rounded px-1.5 py-0.5 text-xs">
                                            <option value="">— pick kind —</option>
                                            <option value="tuition">Tuition</option>
                                            <option value="donation">Donation</option>
                                          </select>
                                        ) : (
                                          <span className={`px-1.5 py-0.5 rounded-full font-medium ${p.charge_kind === 'donation' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                                            {p.charge_kind === 'donation' ? 'Donation' : 'Tuition'}
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-1.5 pl-2">
                                        {!canEdit || !decision.kind ? (
                                          decision.kind === 'donation'
                                            ? <span className="text-slate-500">{categoryLabel(p.suggested_donation_category)}</span>
                                            : <span className="text-slate-500">{feeTypeLabel(p.suggested_fee_type)}</span>
                                        ) : decision.kind === 'tuition' ? (
                                          <div className="flex items-center gap-1">
                                            <select value={decision.feeType} onChange={e => setDecision(p.id, { feeType: e.target.value as FeeType }, decision)}
                                              className="border border-slate-200 rounded px-1.5 py-0.5 text-xs">
                                              <option value="tuition">Tuition</option>
                                              <option value="building_fund">Building Fund</option>
                                              <option value="registration_fee">Registration Fee</option>
                                            </select>
                                            {decision.feeType !== 'registration_fee' && (
                                              studentPlanOptions.length ? (
                                                <select value={decision.planId} onChange={e => setDecision(p.id, { planId: e.target.value }, decision)}
                                                  className="border border-slate-200 rounded px-1.5 py-0.5 text-xs max-w-[8rem]">
                                                  <option value="">— plan —</option>
                                                  {studentPlanOptions.map(pl => <option key={pl.id} value={pl.id}>{pl.academic_year || 'Plan'}</option>)}
                                                </select>
                                              ) : <span className="text-red-500">no plan</span>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1">
                                            <select value={decision.category} onChange={e => setDecision(p.id, { category: e.target.value as DonationCategory }, decision)}
                                              className="border border-slate-200 rounded px-1.5 py-0.5 text-xs">
                                              <option value="one_time">One-Time</option>
                                              <option value="monthly_recurring">Monthly Recurring</option>
                                              <option value="event">Event</option>
                                            </select>
                                            {decision.category === 'event' && (
                                              events.length ? (
                                                <select value={decision.eventId} onChange={e => setDecision(p.id, { eventId: e.target.value }, decision)}
                                                  className="border border-slate-200 rounded px-1.5 py-0.5 text-xs max-w-[8rem]">
                                                  <option value="">— event —</option>
                                                  {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                                                </select>
                                              ) : <span className="text-red-500">no events</span>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                      <td className="py-1.5 pl-2">
                                        <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                                          p.import_status === 'imported' ? 'bg-green-100 text-green-700' :
                                          p.import_status === 'duplicate' ? 'bg-slate-100 text-slate-500' :
                                          p.import_status === 'skipped' ? 'bg-red-50 text-red-500' :
                                          p.import_status === 'needs_review' ? 'bg-red-100 text-red-700' :
                                          'bg-amber-100 text-amber-700'
                                        }`}>{p.import_status === 'needs_review' ? 'possible duplicate' : p.import_status}</span>
                                      </td>
                                      <td className="py-1.5">
                                        {canEdit && decision.kind && (
                                          <button disabled={isBusy || !canImportKind} title={!canImportKind ? `Confirm the ${decision.kind === 'tuition' ? 'student' : 'donor'} match first` : undefined}
                                            onClick={() => importPayments(c.id, c, [p])}
                                            className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                                            Import
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                    {p.import_status === 'needs_review' && p.duplicate_of_donation_id && (() => {
                                      const dup = existingDonations.find(d => d.id === p.duplicate_of_donation_id)
                                      return (
                                        <tr key={`${p.id}-dup`}>
                                          <td colSpan={7} className="pb-2">
                                            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center justify-between flex-wrap gap-2">
                                              <span className="text-red-800">
                                                Might be the same as an existing {dup ? `${formatCurrency(Number(dup.amount))} donation on ${new Date(dup.donation_date + 'T00:00:00').toLocaleDateString()}` : 'donation'} already on file. Same donation, a separate one that happens to match, or a correction?
                                              </span>
                                              <div className="flex items-center gap-1.5">
                                                <button disabled={resolvingId === p.id} onClick={() => resolveDuplicate(p.id, 'same')}
                                                  className="text-xs bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white px-2 py-1 rounded-lg font-medium">Same (skip)</button>
                                                <button disabled={resolvingId === p.id} onClick={() => resolveDuplicate(p.id, 'separate')}
                                                  className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-2 py-1 rounded-lg font-medium">Separate (import both)</button>
                                                <button disabled={resolvingId === p.id} onClick={() => resolveDuplicate(p.id, 'correction')}
                                                  className="text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-2 py-1 rounded-lg font-medium">Correction (update existing)</button>
                                              </div>
                                            </div>
                                          </td>
                                        </tr>
                                      )
                                    })()}
                                    {p.import_status === 'needs_review' && p.duplicate_of_tuition_payment_id && (() => {
                                      const dup = existingPayments.find(d => d.id === p.duplicate_of_tuition_payment_id)
                                      return (
                                        <tr key={`${p.id}-dup`}>
                                          <td colSpan={7} className="pb-2">
                                            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center justify-between flex-wrap gap-2">
                                              <span className="text-red-800">
                                                Might be the same as an existing {dup ? `${formatCurrency(Number(dup.amount))} ${feeTypeLabel(dup.payment_type)} payment on ${dup.payment_date ? new Date(dup.payment_date + 'T00:00:00').toLocaleDateString() : 'an unknown date'}` : 'payment'} already on file, just off by a few days. Same payment, a separate one that happens to match, or a correction?
                                              </span>
                                              <div className="flex items-center gap-1.5">
                                                <button disabled={resolvingId === p.id} onClick={() => resolveDuplicate(p.id, 'same')}
                                                  className="text-xs bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white px-2 py-1 rounded-lg font-medium">Same (skip)</button>
                                                <button disabled={resolvingId === p.id} onClick={() => resolveDuplicate(p.id, 'separate')}
                                                  className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-2 py-1 rounded-lg font-medium">Separate (import both)</button>
                                                <button disabled={resolvingId === p.id} onClick={() => resolveDuplicate(p.id, 'correction')}
                                                  className="text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-2 py-1 rounded-lg font-medium">Correction (update existing)</button>
                                              </div>
                                            </div>
                                          </td>
                                        </tr>
                                      )
                                    })()}
                                  </Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3 text-center">
      <p className={`text-xl font-bold ${accent ?? 'text-slate-800'}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </div>
  )
}
