'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Clock, HelpCircle, Loader2, AlertCircle } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

export type PendingSolaPayment = {
  id: string
  sola_sync_customer_id: string
  sola_sync_schedule_id: string | null
  amount: number | null
  transaction_date: string | null
  charge_kind: 'tuition' | 'donation' | 'ambiguous'
  suggested_fee_type: string | null
  suggested_donation_category: string | null
  import_status: string
}

type FeeType = 'tuition' | 'building_fund' | 'registration_fee'
type DonationCategory = 'monthly_recurring' | 'one_time' | 'event'
type Plan = { id: string; academic_year: string | null; start_date: string | null }
type EventOption = { id: string; name: string }
type CandidatePayment = { id: string; amount: number; payment_date: string | null; payment_type: string | null; tuition_plan_id: string | null }
type TuitionMatch = { candidate: CandidatePayment; days: number; sameMonth: boolean }
type CandidateDonation = { id: string; amount: number; donation_date: string }
type DonationMatch = { candidate: CandidateDonation }

// 'new' means "this is a separate payment, don't match it to anything" —
// an explicit choice, not just the absence of one — otherwise a match
// candidate's id.
type Decision = {
  kind: 'tuition' | 'donation' | null; feeType: FeeType; planId: string; category: DonationCategory; eventId: string
  confirmSchedule: boolean; matchChoice: string
}

// A labeled field for the review controls — plain unlabeled selects
// crammed into one row were reportedly confusing to tell apart at a glance.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-amber-700 uppercase tracking-wide">{label}</span>
      {children}
    </div>
  )
}

function kindLabel(p: PendingSolaPayment) {
  if (p.charge_kind === 'ambiguous') return 'not sure yet'
  if (p.charge_kind === 'tuition') {
    if (p.suggested_fee_type === 'building_fund') return 'looks like Building Fund'
    if (p.suggested_fee_type === 'registration_fee') return 'looks like Registration Fee'
    return 'looks like Tuition'
  }
  return 'looks like a Donation'
}

// Which plan's start_date is closest (either direction) to this payment's
// own date — not just "the current plan," which is what this defaulted to
// before and silently misattributed a payment from a prior year onto this
// year's plan (confirmed live: a payment dated mid-August landed on the
// plan that started that same month a year later, since it was simply
// first in the list). Comparing by nearest start_date rather than requiring
// the date to fall strictly within [start_date, end_date] because this
// school's own payment dates routinely land a week or two before the plan's
// recorded start_date (first-of-month billing vs. a semester's formal
// start) — a strict range check would fail to match the correct plan too.
function bestPlanIdForDate(dateStr: string | null, plans: Plan[]): string {
  if (!plans.length) return ''
  if (!dateStr) return plans[0].id
  const targetMs = new Date(`${dateStr}T00:00:00`).getTime()
  let best = plans[0]
  let bestDiff = Infinity
  for (const p of plans) {
    if (!p.start_date) continue
    const diff = Math.abs(new Date(`${p.start_date}T00:00:00`).getTime() - targetMs)
    if (diff < bestDiff) { bestDiff = diff; best = p }
  }
  return best.id
}

// Every existing payment that could plausibly be this same charge — same
// fee type/plan/amount, within the configured merge window — not just the
// single closest one, so staff can see and pick from real options instead
// of a single auto-guess they can only accept or reject. Mirrors (kept in
// sync with by hand, not shared code, since one runs in the browser and one
// on the server) the matching logic in app/api/sola/sync/import/route.ts.
// Sorted closest-first; a same-calendar-month match is flagged sameMonth
// since that's what the server auto-merges on when no explicit choice is
// sent. This is what resolved the actual incident that prompted this whole
// preview feature — two families each had a Sola-sourced payment silently
// duplicate an already-recorded one because the plan picker defaulted to
// the wrong year, invisibly until reviewed after the fact.
function findTuitionMatches(
  payment: PendingSolaPayment, feeType: FeeType, planId: string,
  candidates: CandidatePayment[], mergeWindowDays: number
): TuitionMatch[] {
  const isRegFee = feeType === 'registration_fee'
  const monthKey = (d: string | null) => (d ? d.slice(0, 7) : null)
  if (!payment.transaction_date) return []
  const matches: TuitionMatch[] = []
  for (const c of candidates) {
    if (c.payment_type !== feeType) continue
    if (isRegFee ? c.tuition_plan_id != null : c.tuition_plan_id !== planId) continue
    if (Number(c.amount) !== Number(payment.amount)) continue
    if (!c.payment_date) continue
    const sameMonth = monthKey(c.payment_date) === monthKey(payment.transaction_date)
    const days = Math.abs((new Date(`${c.payment_date}T00:00:00`).getTime() - new Date(`${payment.transaction_date}T00:00:00`).getTime()) / 86400000)
    if (sameMonth || days <= mergeWindowDays) matches.push({ candidate: c, days, sameMonth })
  }
  return matches.sort((a, b) => a.days - b.days)
}

function tuitionMatchLabel(m: TuitionMatch): string {
  const date = new Date(`${m.candidate.payment_date}T00:00:00`).toLocaleDateString()
  return `Same as ${formatCurrency(Number(m.candidate.amount))} on ${date}${m.sameMonth ? '' : ` (${Math.round(m.days)}d off)`}`
}

// Donation side — mirrors the import route's donation branch, deliberately
// simpler than tuition's: only a same-amount/same-calendar-month match
// counts at all (no day-window fuzzy match), and it's never auto-merged —
// always routed to manual review even when chosen explicitly here, since a
// donor giving twice in one month for different reasons is plausible
// enough that this app never silently treats two donations as the same one.
function findDonationMatches(payment: PendingSolaPayment, candidates: CandidateDonation[]): DonationMatch[] {
  const monthKey = (d: string | null) => (d ? d.slice(0, 7) : null)
  return candidates
    .filter(c => Number(c.amount) === Number(payment.amount) && monthKey(c.donation_date) === monthKey(payment.transaction_date))
    .map(c => ({ candidate: c }))
}

function donationMatchLabel(m: DonationMatch): string {
  return `Same as ${formatCurrency(Number(m.candidate.amount))} on ${new Date(`${m.candidate.donation_date}T00:00:00`).toLocaleDateString()}`
}

function defaultDecision(p: PendingSolaPayment, plans: Plan[]): Decision {
  return {
    kind: p.charge_kind === 'ambiguous' ? null : p.charge_kind,
    feeType: (p.suggested_fee_type as FeeType) ?? 'tuition',
    planId: bestPlanIdForDate(p.transaction_date, plans),
    category: (p.suggested_donation_category as DonationCategory) ?? 'one_time',
    eventId: '',
    // Defaults on when this payment came from a real recurring schedule —
    // that's almost always what staff want (stop re-reviewing every month),
    // and it's a single checkbox to turn off for the rare exception.
    confirmSchedule: !!p.sola_sync_schedule_id,
    // '' = not yet touched by staff — the dropdown shows/uses the closest
    // match as a default (see effectiveMatchChoice) without that default
    // being "sticky" as an actual explicit choice until they interact with it.
    matchChoice: '',
  }
}

// The dropdown's actual value: whatever staff explicitly picked, or — if
// they haven't touched it — the closest match as a sensible default (or
// 'new' if there isn't one). Kept separate from the stored decision so an
// auto-picked default doesn't masquerade as a deliberate choice in the UI.
function effectiveMatchChoice(matchChoice: string, matches: { candidate: { id: string } }[]): string {
  return matchChoice || matches[0]?.candidate.id || 'new'
}

// A Sola charge that's real (approved, actual money moved) but hasn't been
// reviewed/imported into tuition_payments or donations yet — surfaced here so
// staff see it on the family's own record right away instead of only in the
// Sola Sync queue, which nobody may think to check. 'pending' rows (never
// touched) can be classified and imported right here — 'needs_review' rows
// (already flagged as a possible duplicate against something else on file)
// still route to Sola Sync, since resolving those needs to see the specific
// payment they might duplicate, which this compact card has no room for.
export default function IncomingSolaPayments({ payments, type, plans, events, tuitionCandidates, mergeWindowDays, donationCandidates, onResolved }: {
  payments: PendingSolaPayment[]
  type: 'student' | 'donor'
  plans?: Plan[]
  events?: EventOption[]
  // Existing tuition_payments not already tied to a Sola transaction —
  // the candidate pool the live match preview checks against. Omit to
  // hide the preview line entirely (falls back to the plain Import button).
  tuitionCandidates?: CandidatePayment[]
  mergeWindowDays?: number
  // Same idea for donations — existing donations not already tied to a
  // Sola transaction. Omit to hide that preview line.
  donationCandidates?: CandidateDonation[]
  onResolved: () => void
}) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, { type: 'error'; msg: string }>>({})

  if (!payments.length) return null
  const total = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0)

  function getDecision(p: PendingSolaPayment): Decision {
    return decisions[p.id] ?? defaultDecision(p, plans ?? [])
  }
  function setDecision(id: string, patch: Partial<Decision>, fallback: Decision) {
    setDecisions(d => ({ ...d, [id]: { ...(d[id] ?? fallback), ...patch } }))
  }

  async function importOne(p: PendingSolaPayment) {
    const d = getDecision(p)
    if (!d.kind) return

    let matchChoice = ''
    if (d.kind === 'tuition' && tuitionCandidates) {
      const matches = findTuitionMatches(p, d.feeType, d.planId, tuitionCandidates, mergeWindowDays ?? 30)
      matchChoice = effectiveMatchChoice(d.matchChoice, matches)
    } else if (d.kind === 'donation' && donationCandidates) {
      const matches = findDonationMatches(p, donationCandidates)
      matchChoice = effectiveMatchChoice(d.matchChoice, matches)
    }

    setBusyId(p.id)
    setResult(r => ({ ...r, [p.id]: undefined as unknown as { type: 'error'; msg: string } }))
    try {
      const matchFields = matchChoice === 'new' ? { forceNew: true }
        : matchChoice ? (d.kind === 'tuition' ? { matchedTuitionPaymentId: matchChoice } : { matchedDonationId: matchChoice })
        : {}
      const decisionPayload = d.kind === 'tuition'
        ? { syncPaymentId: p.id, kind: 'tuition', feeType: d.feeType, tuitionPlanId: d.feeType === 'registration_fee' ? null : (d.planId || null), ...matchFields }
        : { syncPaymentId: p.id, kind: 'donation', category: d.category, eventId: d.category === 'event' ? (d.eventId || null) : null, ...matchFields }
      const res = await fetch('/api/sola/sync/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncCustomerId: p.sola_sync_customer_id, decisions: [decisionPayload] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Import failed.')
      const outcome = json.results?.[0]
      if (outcome && outcome.status !== 'imported' && outcome.status !== 'merged') {
        throw new Error(outcome.reason || `Couldn't import (${outcome.status}).`)
      }

      // Confirm the schedule itself so future payments from it skip review
      // entirely instead of needing this same decision made again next time
      // — see isScheduleConfirmed in app/api/sola/sync/import/route.ts.
      if (d.confirmSchedule && p.sola_sync_schedule_id) {
        const confirmRes = await fetch('/api/sola/sync/set-default', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            d.kind === 'tuition'
              ? { target: 'schedule', id: p.sola_sync_schedule_id, purpose: d.feeType, tuitionPlanId: d.feeType === 'registration_fee' ? null : (d.planId || null) }
              : { target: 'schedule', id: p.sola_sync_schedule_id, purpose: 'donation', donationCategory: d.category }
          ),
        })
        if (!confirmRes.ok) {
          const j = await confirmRes.json().catch(() => null)
          throw new Error(`Imported, but couldn't confirm the schedule: ${j?.error || 'unknown error'}`)
        }
      }

      onResolved()
    } catch (err) {
      setResult(r => ({ ...r, [p.id]: { type: 'error', msg: err instanceof Error ? err.message : 'Import failed.' } }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
          <Clock size={16} />
          Incoming from Sola — not yet categorized ({payments.length}, {formatCurrency(total)})
        </div>
        <Link href="/admin/sola-sync" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
          Open Sola Sync
        </Link>
      </div>
      <p className="text-xs text-amber-700 mb-2">
        Sola shows this money as received, but it hasn&apos;t been recorded here yet — it won&apos;t count toward balance until reviewed.
      </p>
      <div className="space-y-1.5">
        {payments.map(p => {
          const canReview = p.import_status === 'pending'
          const d = getDecision(p)
          const busy = busyId === p.id
          return (
            <div key={p.id} className="bg-white/60 rounded-lg px-2.5 py-1.5 text-xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-amber-900">{p.transaction_date ? new Date(p.transaction_date + 'T00:00:00').toLocaleDateString() : 'Unknown date'}</span>
                <span className="text-amber-900 font-medium">{p.amount != null ? formatCurrency(Number(p.amount)) : '—'}</span>
                {!canReview && (
                  <span className="flex items-center gap-1 text-amber-600">
                    {p.charge_kind === 'ambiguous' && <HelpCircle size={12} />}
                    {kindLabel(p)}
                  </span>
                )}
              </div>

              {canReview ? (
                <div className="pt-1.5 border-t border-amber-100 space-y-2">
                  <div className="flex items-end gap-2.5 flex-wrap">
                    <Field label="Kind">
                      <select disabled={busy} value={d.kind ?? ''} onChange={e => setDecision(p.id, { kind: (e.target.value || null) as Decision['kind'] }, d)}
                        className="border border-amber-200 rounded px-1.5 py-1 text-xs bg-white disabled:opacity-50">
                        <option value="">— choose —</option>
                        <option value="tuition">Tuition</option>
                        <option value="donation">Donation</option>
                      </select>
                    </Field>
                    {d.kind === 'tuition' && (
                      <>
                        <Field label="Fee type">
                          <select disabled={busy} value={d.feeType} onChange={e => setDecision(p.id, { feeType: e.target.value as FeeType, matchChoice: '' }, d)}
                            className="border border-amber-200 rounded px-1.5 py-1 text-xs bg-white disabled:opacity-50">
                            <option value="tuition">Tuition</option>
                            <option value="building_fund">Building Fund</option>
                            <option value="registration_fee">Registration Fee</option>
                          </select>
                        </Field>
                        {d.feeType !== 'registration_fee' && (
                          (plans?.length ?? 0) > 0 ? (
                            <Field label="Plan / year">
                              <select disabled={busy} value={d.planId} onChange={e => setDecision(p.id, { planId: e.target.value, matchChoice: '' }, d)}
                                className="border border-amber-200 rounded px-1.5 py-1 text-xs bg-white disabled:opacity-50 max-w-[7.5rem]">
                                {plans!.map(pl => <option key={pl.id} value={pl.id}>{pl.academic_year || 'Plan'}</option>)}
                              </select>
                            </Field>
                          ) : <span className="text-red-500 pb-1">no plan on file</span>
                        )}
                      </>
                    )}
                    {d.kind === 'donation' && (
                      <>
                        <Field label="Category">
                          <select disabled={busy} value={d.category} onChange={e => setDecision(p.id, { category: e.target.value as DonationCategory }, d)}
                            className="border border-amber-200 rounded px-1.5 py-1 text-xs bg-white disabled:opacity-50">
                            <option value="one_time">One-Time</option>
                            <option value="monthly_recurring">Monthly Recurring</option>
                            <option value="event">Event</option>
                          </select>
                        </Field>
                        {d.category === 'event' && (
                          (events?.length ?? 0) > 0 ? (
                            <Field label="Event">
                              <select disabled={busy} value={d.eventId} onChange={e => setDecision(p.id, { eventId: e.target.value }, d)}
                                className="border border-amber-200 rounded px-1.5 py-1 text-xs bg-white disabled:opacity-50 max-w-[7.5rem]">
                                <option value="">— event —</option>
                                {events!.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                              </select>
                            </Field>
                          ) : <span className="text-red-500 pb-1">no events</span>
                        )}
                      </>
                    )}
                  </div>

                  {d.kind === 'tuition' && tuitionCandidates && (d.feeType === 'registration_fee' || d.planId) && (() => {
                    const matches = findTuitionMatches(p, d.feeType, d.planId, tuitionCandidates, mergeWindowDays ?? 30)
                    const choice = effectiveMatchChoice(d.matchChoice, matches)
                    return (
                      <Field label="Match this up with">
                        <select disabled={busy} value={choice} onChange={e => setDecision(p.id, { matchChoice: e.target.value }, d)}
                          className="border border-amber-200 rounded px-1.5 py-1 text-xs bg-white disabled:opacity-50 w-full max-w-xs">
                          <option value="new">This is a new, separate payment</option>
                          {matches.map(m => (
                            <option key={m.candidate.id} value={m.candidate.id}>{tuitionMatchLabel(m)}</option>
                          ))}
                        </select>
                      </Field>
                    )
                  })()}
                  {d.kind === 'donation' && donationCandidates && (() => {
                    const matches = findDonationMatches(p, donationCandidates)
                    const choice = effectiveMatchChoice(d.matchChoice, matches)
                    return (
                      <Field label="Match this up with">
                        <select disabled={busy} value={choice} onChange={e => setDecision(p.id, { matchChoice: e.target.value }, d)}
                          className="border border-amber-200 rounded px-1.5 py-1 text-xs bg-white disabled:opacity-50 w-full max-w-xs">
                          <option value="new">This is a new, separate donation</option>
                          {matches.map(m => (
                            <option key={m.candidate.id} value={m.candidate.id}>{donationMatchLabel(m)}</option>
                          ))}
                        </select>
                      </Field>
                    )
                  })()}

                  {p.sola_sync_schedule_id && d.kind && (
                    <label className="flex items-center gap-1.5 text-amber-700">
                      <input type="checkbox" checked={d.confirmSchedule} disabled={busy}
                        onChange={e => setDecision(p.id, { confirmSchedule: e.target.checked }, d)} />
                      Also apply to all future payments on this schedule — skip review next time
                    </label>
                  )}

                  <button
                    disabled={busy || !d.kind || (d.kind === 'tuition' && d.feeType !== 'registration_fee' && !d.planId)}
                    onClick={() => importOne(p)}
                    className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    {busy && <Loader2 size={11} className="animate-spin" />} Import
                  </button>
                </div>
              ) : (
                <p className="text-amber-600 text-[11px]">Possible duplicate flagged — resolve on the Sola Sync page.</p>
              )}
              {result[p.id] && (
                <p className="flex items-center gap-1 text-red-600"><AlertCircle size={11} /> {result[p.id].msg}</p>
              )}
            </div>
          )
        })}
      </div>
      {type === 'student' && !plans?.length && payments.some(p => p.import_status === 'pending') && (
        <p className="text-[11px] text-amber-600 mt-2">This student has no tuition plan yet — add one before importing a Tuition/Building Fund payment.</p>
      )}
    </div>
  )
}
