'use client'

import { useState } from 'react'
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
type Plan = { id: string; academic_year: string | null }
type EventOption = { id: string; name: string }

type Decision = { kind: 'tuition' | 'donation' | null; feeType: FeeType; planId: string; category: DonationCategory; eventId: string; confirmSchedule: boolean }

function kindLabel(p: PendingSolaPayment) {
  if (p.charge_kind === 'ambiguous') return 'not sure yet'
  if (p.charge_kind === 'tuition') {
    if (p.suggested_fee_type === 'building_fund') return 'looks like Building Fund'
    if (p.suggested_fee_type === 'registration_fee') return 'looks like Registration Fee'
    return 'looks like Tuition'
  }
  return 'looks like a Donation'
}

function defaultDecision(p: PendingSolaPayment, defaultPlanId: string): Decision {
  return {
    kind: p.charge_kind === 'ambiguous' ? null : p.charge_kind,
    feeType: (p.suggested_fee_type as FeeType) ?? 'tuition',
    planId: defaultPlanId,
    category: (p.suggested_donation_category as DonationCategory) ?? 'one_time',
    eventId: '',
    // Defaults on when this payment came from a real recurring schedule —
    // that's almost always what staff want (stop re-reviewing every month),
    // and it's a single checkbox to turn off for the rare exception.
    confirmSchedule: !!p.sola_sync_schedule_id,
  }
}

// A Sola charge that's real (approved, actual money moved) but hasn't been
// reviewed/imported into tuition_payments or donations yet — surfaced here so
// staff see it on the family's own record right away instead of only in the
// Sola Sync queue, which nobody may think to check. 'pending' rows (never
// touched) can be classified and imported right here — 'needs_review' rows
// (already flagged as a possible duplicate against something else on file)
// still route to Sola Sync, since resolving those needs to see the specific
// payment they might duplicate, which this compact card has no room for.
export default function IncomingSolaPayments({ payments, type, plans, events, onResolved }: {
  payments: PendingSolaPayment[]
  type: 'student' | 'donor'
  plans?: Plan[]
  events?: EventOption[]
  onResolved: () => void
}) {
  const defaultPlanId = plans?.[0]?.id ?? ''
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, { type: 'error'; msg: string }>>({})

  if (!payments.length) return null
  const total = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0)

  function getDecision(p: PendingSolaPayment): Decision {
    return decisions[p.id] ?? defaultDecision(p, defaultPlanId)
  }
  function setDecision(id: string, patch: Partial<Decision>, fallback: Decision) {
    setDecisions(d => ({ ...d, [id]: { ...(d[id] ?? fallback), ...patch } }))
  }

  async function importOne(p: PendingSolaPayment) {
    const d = getDecision(p)
    if (!d.kind) return
    setBusyId(p.id)
    setResult(r => ({ ...r, [p.id]: undefined as unknown as { type: 'error'; msg: string } }))
    try {
      const decisionPayload = d.kind === 'tuition'
        ? { syncPaymentId: p.id, kind: 'tuition', feeType: d.feeType, tuitionPlanId: d.feeType === 'registration_fee' ? null : (d.planId || null) }
        : { syncPaymentId: p.id, kind: 'donation', category: d.category, eventId: d.category === 'event' ? (d.eventId || null) : null }
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
                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-amber-100">
                  <select disabled={busy} value={d.kind ?? ''} onChange={e => setDecision(p.id, { kind: (e.target.value || null) as Decision['kind'] }, d)}
                    className="border border-amber-200 rounded px-1.5 py-0.5 text-xs bg-white disabled:opacity-50">
                    <option value="">— kind —</option>
                    <option value="tuition">Tuition</option>
                    <option value="donation">Donation</option>
                  </select>
                  {d.kind === 'tuition' && (
                    <>
                      <select disabled={busy} value={d.feeType} onChange={e => setDecision(p.id, { feeType: e.target.value as FeeType }, d)}
                        className="border border-amber-200 rounded px-1.5 py-0.5 text-xs bg-white disabled:opacity-50">
                        <option value="tuition">Tuition</option>
                        <option value="building_fund">Building Fund</option>
                        <option value="registration_fee">Registration Fee</option>
                      </select>
                      {d.feeType !== 'registration_fee' && (
                        (plans?.length ?? 0) > 0 ? (
                          <select disabled={busy} value={d.planId} onChange={e => setDecision(p.id, { planId: e.target.value }, d)}
                            className="border border-amber-200 rounded px-1.5 py-0.5 text-xs bg-white disabled:opacity-50 max-w-[7rem]">
                            {plans!.map(pl => <option key={pl.id} value={pl.id}>{pl.academic_year || 'Plan'}</option>)}
                          </select>
                        ) : <span className="text-red-500">no plan on file</span>
                      )}
                    </>
                  )}
                  {d.kind === 'donation' && (
                    <>
                      <select disabled={busy} value={d.category} onChange={e => setDecision(p.id, { category: e.target.value as DonationCategory }, d)}
                        className="border border-amber-200 rounded px-1.5 py-0.5 text-xs bg-white disabled:opacity-50">
                        <option value="one_time">One-Time</option>
                        <option value="monthly_recurring">Monthly Recurring</option>
                        <option value="event">Event</option>
                      </select>
                      {d.category === 'event' && (
                        (events?.length ?? 0) > 0 ? (
                          <select disabled={busy} value={d.eventId} onChange={e => setDecision(p.id, { eventId: e.target.value }, d)}
                            className="border border-amber-200 rounded px-1.5 py-0.5 text-xs bg-white disabled:opacity-50 max-w-[7rem]">
                            <option value="">— event —</option>
                            {events!.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                          </select>
                        ) : <span className="text-red-500">no events</span>
                      )}
                    </>
                  )}
                  <button
                    disabled={busy || !d.kind || (d.kind === 'tuition' && d.feeType !== 'registration_fee' && !d.planId)}
                    onClick={() => importOne(p)}
                    className="ml-auto flex items-center gap-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                  >
                    {busy && <Loader2 size={11} className="animate-spin" />} Import
                  </button>
                  {p.sola_sync_schedule_id && d.kind && (
                    <label className="flex items-center gap-1.5 text-amber-700 w-full pt-0.5">
                      <input type="checkbox" checked={d.confirmSchedule} disabled={busy}
                        onChange={e => setDecision(p.id, { confirmSchedule: e.target.checked }, d)} />
                      Also apply to all future payments on this schedule — skip review next time
                    </label>
                  )}
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
