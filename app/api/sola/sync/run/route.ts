import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { listAllCustomers, listAllSchedules, listAllTransactions } from '@/lib/sola/client'
import { normalizeName, normalizeEmail, classifyCharge } from '@/lib/sola/classify'
import type { SolaSchedule } from '@/lib/sola/types'

// Supabase/PostgREST caps an unpaginated select at max_rows (1000 in this
// project) — confirmed to actually bite this account once sola_sync_payments
// passed 1000 rows: the "already staged" dedup check silently missed the
// overflow and started re-attempting inserts for transactions that were
// already staged, which then failed on the unique constraint. Every bulk
// read in this route pages explicitly so none of them can silently truncate
// as the account grows.
async function selectAll<T>(
  build: (supabase: SupabaseClient, from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  supabase: SupabaseClient
): Promise<T[]> {
  const all: T[] = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await build(supabase, from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    all.push(...(data ?? []))
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return all
}

// Pulls the full customer/schedule/transaction picture from Sola and stages
// it for review — never writes to tuition_payments/donations directly. Safe
// to run repeatedly: existing sola_sync_customers rows keep whatever match
// state a staff member has already set (student match, donor match, "not a
// student/donor", merged) — a re-sync only refreshes passive fields (name,
// schedule progress) and appends transactions that weren't seen before.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let customers, schedules, transactions
  try {
    ;[customers, schedules, transactions] = await Promise.all([
      listAllCustomers(), listAllSchedules(), listAllTransactions(),
    ])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to fetch from Sola' }, { status: 502 })
  }

  type StudentRow = {
    id: string; first_name: string; last_name: string; sola_customer_id: string | null
    father_name: string | null; father_email: string | null; mother_name: string | null; mother_email: string | null
  }
  const students = await selectAll<StudentRow>(
    (sb, from, to) => sb.from('students').select('id,first_name,last_name,sola_customer_id,father_name,father_email,mother_name,mother_email').range(from, to),
    supabase
  )
  const bySolaId = new Map(students.filter(s => s.sola_customer_id).map(s => [s.sola_customer_id as string, s]))
  const byId = new Map(students.map(s => [s.id, s]))
  const nameMap = new Map<string, { id: string }[]>()
  for (const s of students) {
    const key = `${normalizeName(s.first_name)}|${normalizeName(s.last_name)}`
    if (!nameMap.has(key)) nameMap.set(key, [])
    nameMap.get(key)!.push(s)
  }

  // Parent-of-student candidate pool: normalized parent name/email -> student.
  // father_name/mother_name are stored first-name-only in this data (e.g. a
  // student "Yitzy Brand" has father_name "Yechiel", not "Yechiel Brand"),
  // while Sola stores full names — so the primary key assumes the parent
  // shares the student's surname. Also register the raw field as-is in case
  // a record was entered with a full name, so both conventions match.
  const parentNameMap = new Map<string, { id: string }>()
  const parentEmailMap = new Map<string, { id: string }>()
  for (const s of students) {
    if (s.father_name) {
      parentNameMap.set(normalizeName(`${s.father_name} ${s.last_name}`), s)
      parentNameMap.set(normalizeName(s.father_name), s)
    }
    if (s.mother_name) {
      parentNameMap.set(normalizeName(`${s.mother_name} ${s.last_name}`), s)
      parentNameMap.set(normalizeName(s.mother_name), s)
    }
    if (s.father_email) parentEmailMap.set(normalizeEmail(s.father_email), s)
    if (s.mother_email) parentEmailMap.set(normalizeEmail(s.mother_email), s)
  }

  type DonorRow = { id: string; name: string; email: string | null; sola_customer_id: string | null }
  const donors = await selectAll<DonorRow>(
    (sb, from, to) => sb.from('donors').select('id,name,email,sola_customer_id').range(from, to),
    supabase
  )
  const donorBySolaId = new Map(donors.filter(d => d.sola_customer_id).map(d => [d.sola_customer_id as string, d]))
  const donorByName = new Map(donors.map(d => [normalizeName(d.name), d]))
  const donorByEmail = new Map(donors.filter(d => d.email).map(d => [normalizeEmail(d.email), d]))

  const existingSyncRows = await selectAll<{ id: string; sola_customer_id: string }>(
    (sb, from, to) => sb.from('sola_sync_customers').select('id,sola_customer_id').range(from, to),
    supabase
  )
  const existingBySolaCustomerId = new Map(existingSyncRows.map(r => [r.sola_customer_id, r.id]))

  const existingImported = await selectAll<{ sola_transaction_id: string }>(
    (sb, from, to) => sb.from('tuition_payments').select('sola_transaction_id').not('sola_transaction_id', 'is', null).range(from, to),
    supabase
  )
  const importedTxnIds = new Set(existingImported.map(r => r.sola_transaction_id))
  const existingDonationsImported = await selectAll<{ sola_transaction_id: string }>(
    (sb, from, to) => sb.from('donations').select('sola_transaction_id').not('sola_transaction_id', 'is', null).range(from, to),
    supabase
  )
  for (const r of existingDonationsImported) importedTxnIds.add(r.sola_transaction_id)

  // ── Customers: insert new ones with freshly computed student AND donor
  // matches, refresh passive fields on ones we've already staged. ─────────
  const newCustomerRows: Record<string, unknown>[] = []
  const refreshCustomerIds: string[] = []
  for (const c of customers) {
    if (existingBySolaCustomerId.has(c.customerId)) {
      refreshCustomerIds.push(c.customerId)
      continue
    }
    const fullName = normalizeName(`${c.billFirstName ?? ''} ${c.billLastName ?? ''}`)
    const email = normalizeEmail(c.email)

    let matchStatus: string = 'unmatched'
    let matchedStudentId: string | null = null
    let matchMethod: string | null = null
    const byNumber = c.customerNumber ? byId.get(c.customerNumber) : undefined
    if (bySolaId.has(c.customerId)) {
      matchStatus = 'matched'; matchedStudentId = bySolaId.get(c.customerId)!.id; matchMethod = 'sola_customer_id'
    } else if (byNumber) {
      matchStatus = 'matched'; matchedStudentId = byNumber.id; matchMethod = 'customer_number'
    } else {
      const key = `${normalizeName(c.billFirstName)}|${normalizeName(c.billLastName)}`
      const candidates = key !== '|' ? (nameMap.get(key) ?? []) : []
      if (candidates.length === 1) {
        matchStatus = 'needs_review'; matchedStudentId = candidates[0].id; matchMethod = 'name_fuzzy'
      }
    }

    // Donor identity is independent of the student identity above — the
    // same Sola customer can be a confirmed tuition payer AND a donor
    // candidate at once (e.g. a parent who also gives to a dinner).
    let donorMatchStatus = 'unmatched'
    let matchedDonorId: string | null = null
    let donorMatchMethod: string | null = null
    let suggestedDonorStudentId: string | null = null
    const existingDonor = donorBySolaId.get(c.customerId)
      ?? (fullName ? donorByName.get(fullName) : undefined)
      ?? (email ? donorByEmail.get(email) : undefined)
    if (donorBySolaId.has(c.customerId)) {
      donorMatchStatus = 'matched'; matchedDonorId = existingDonor!.id; donorMatchMethod = 'sola_customer_id'
    } else if (existingDonor) {
      donorMatchStatus = 'needs_review'; matchedDonorId = existingDonor.id; donorMatchMethod = 'name_fuzzy'
    } else {
      const parentMatch = (fullName ? parentNameMap.get(fullName) : undefined) ?? (email ? parentEmailMap.get(email) : undefined)
      if (parentMatch) {
        donorMatchStatus = 'needs_review'; donorMatchMethod = 'parent_of_student'; suggestedDonorStudentId = parentMatch.id
      }
    }

    newCustomerRows.push({
      sola_customer_id: c.customerId, sola_customer_number: c.customerNumber ?? null,
      bill_first_name: c.billFirstName ?? null, bill_last_name: c.billLastName ?? null, email: c.email ?? null,
      match_status: matchStatus, matched_student_id: matchedStudentId, match_method: matchMethod,
      donor_match_status: donorMatchStatus, matched_donor_id: matchedDonorId, donor_match_method: donorMatchMethod,
      suggested_donor_student_id: suggestedDonorStudentId,
    })
  }
  if (newCustomerRows.length) {
    const { error } = await supabase.from('sola_sync_customers').insert(newCustomerRows)
    if (error) return NextResponse.json({ error: `Failed to stage Sola customers: ${error.message}` }, { status: 500 })
  }
  for (const solaCustomerId of refreshCustomerIds) {
    const c = customers.find(x => x.customerId === solaCustomerId)!
    await supabase.from('sola_sync_customers')
      .update({ bill_first_name: c.billFirstName ?? null, bill_last_name: c.billLastName ?? null, email: c.email ?? null, last_synced_at: new Date().toISOString() })
      .eq('sola_customer_id', solaCustomerId)
  }

  // Re-fetch so we have local uuids for every sola_sync_customers row (both
  // pre-existing and just-inserted) to attach schedules/payments to.
  const allSyncCustomers = await selectAll<{ id: string; sola_customer_id: string; default_purpose: string | null; default_donation_category: string | null }>(
    (sb, from, to) => sb.from('sola_sync_customers').select('id,sola_customer_id,default_purpose,default_donation_category').range(from, to),
    supabase
  )
  const syncCustomerIdBySolaId = new Map(allSyncCustomers.map(r => [r.sola_customer_id, r.id]))
  const customerDefaultsById = new Map(allSyncCustomers.map(r => [r.id, { purpose: r.default_purpose, category: r.default_donation_category }]))

  // ── Schedules: always refresh — PaymentsProcessed/status legitimately
  // change over time in Sola, unlike customer match state. ────────────────
  const scheduleById = new Map(schedules.map(s => [s.scheduleId, s]))
  for (const s of schedules) {
    const syncCustomerId = syncCustomerIdBySolaId.get(s.customerId)
    if (!syncCustomerId) continue // schedule belongs to a customer this sync didn't see (shouldn't happen)
    await supabase.from('sola_sync_schedules').upsert([{
      sola_sync_customer_id: syncCustomerId, sola_schedule_id: s.scheduleId, description: s.description ?? null,
      amount: s.amount ?? null, interval_type: s.intervalType ?? null, interval_count: s.intervalCount ?? null,
      total_payments: s.totalPayments ?? null, payments_processed: s.paymentsProcessed ?? null,
      next_scheduled_date: s.nextScheduledRunTime ?? null,
    }], { onConflict: 'sola_schedule_id' })
  }

  // ── Payments: insert only transactions we've never staged before.
  // Amount is inferred from the parent schedule (Sola exposes no per-
  // transaction amount at all). Declined/errored transactions are staged
  // but auto-skipped — they never represent money actually received. ─────
  const allSyncSchedules = await selectAll<{ id: string; sola_schedule_id: string; default_purpose: string | null; default_donation_category: string | null }>(
    (sb, from, to) => sb.from('sola_sync_schedules').select('id,sola_schedule_id,default_purpose,default_donation_category').range(from, to),
    supabase
  )
  const syncScheduleIdBySolaId = new Map(allSyncSchedules.map(r => [r.sola_schedule_id, r.id]))
  const scheduleDefaultsById = new Map(allSyncSchedules.map(r => [r.id, { purpose: r.default_purpose, category: r.default_donation_category }]))

  // A staff-set default (via /api/sola/sync/set-default) overrides the
  // keyword-heuristic classifyCharge for any payment newly staged after the
  // default was set — schedule-level wins over customer-level, since one
  // customer can have both a tuition schedule and a donation schedule.
  // Never re-classifies a payment already staged: this only runs inside the
  // "new transactions" branch below.
  function classificationFromDefault(purpose: string | null, category: string | null) {
    if (purpose === 'donation') return { chargeKind: 'donation' as const, suggestedFeeType: null, suggestedDonationCategory: (category as 'monthly_recurring' | 'one_time' | 'event' | null) ?? 'one_time' }
    if (purpose === 'tuition' || purpose === 'building_fund' || purpose === 'registration_fee') {
      return { chargeKind: 'tuition' as const, suggestedFeeType: purpose as 'tuition' | 'building_fund' | 'registration_fee', suggestedDonationCategory: null }
    }
    return null
  }
  const existingSyncPayments = await selectAll<{ sola_transaction_id: string }>(
    (sb, from, to) => sb.from('sola_sync_payments').select('sola_transaction_id').range(from, to),
    supabase
  )
  const stagedTxnIds = new Set(existingSyncPayments.map(r => r.sola_transaction_id))

  const newPaymentRows: Record<string, unknown>[] = []
  for (const t of transactions) {
    if (stagedTxnIds.has(t.transactionId)) continue
    const syncCustomerId = syncCustomerIdBySolaId.get(t.customerId)
    if (!syncCustomerId) continue
    const schedule: SolaSchedule | undefined = t.scheduleId ? scheduleById.get(t.scheduleId) : undefined
    const amount = schedule?.amount ?? null
    const approved = t.gatewayStatus === 'Approved'
    const localScheduleId = t.scheduleId ? (syncScheduleIdBySolaId.get(t.scheduleId) ?? null) : null
    const scheduleDefault = localScheduleId ? scheduleDefaultsById.get(localScheduleId) : undefined
    const customerDefault = customerDefaultsById.get(syncCustomerId)
    // Classification reflects the real charge regardless of approval status
    // — only import eligibility (below) depends on approved, so a declined
    // "Donation x6" charge still shows as a donation in the review UI
    // instead of a misleading placeholder, even though it's auto-skipped.
    const { chargeKind, suggestedFeeType, suggestedDonationCategory } =
      (scheduleDefault && classificationFromDefault(scheduleDefault.purpose, scheduleDefault.category))
      || (customerDefault && classificationFromDefault(customerDefault.purpose, customerDefault.category))
      || classifyCharge(schedule, amount)
    newPaymentRows.push({
      sola_sync_customer_id: syncCustomerId,
      sola_sync_schedule_id: localScheduleId,
      sola_transaction_id: t.transactionId,
      amount,
      transaction_date: t.transactionDate ? t.transactionDate.slice(0, 10) : null,
      gateway_status: t.gatewayStatus ?? null,
      charge_kind: chargeKind,
      suggested_fee_type: suggestedFeeType,
      suggested_donation_category: suggestedDonationCategory,
      import_status: importedTxnIds.has(t.transactionId) ? 'duplicate' : (approved ? 'pending' : 'skipped'),
    })
  }
  if (newPaymentRows.length) {
    const { error } = await supabase.from('sola_sync_payments').insert(newPaymentRows)
    if (error) return NextResponse.json({ error: `Failed to stage Sola payments: ${error.message}` }, { status: 500 })
  }

  const statusCounts = await selectAll<{ match_status: string; donor_match_status: string }>(
    (sb, from, to) => sb.from('sola_sync_customers').select('match_status,donor_match_status').range(from, to),
    supabase
  )
  const summary = { matched: 0, needs_review: 0, unmatched: 0, not_a_student: 0, merged: 0 }
  const donorSummary = { matched: 0, needs_review: 0, unmatched: 0, not_a_donor: 0 }
  for (const r of statusCounts) {
    if (r.match_status in summary) (summary as Record<string, number>)[r.match_status]++
    if (r.donor_match_status in donorSummary) (donorSummary as Record<string, number>)[r.donor_match_status]++
  }

  return NextResponse.json({
    customersSeen: customers.length,
    schedulesSeen: schedules.length,
    transactionsSeen: transactions.length,
    newCustomers: newCustomerRows.length,
    newPayments: newPaymentRows.length,
    summary,
    donorSummary,
  })
}
