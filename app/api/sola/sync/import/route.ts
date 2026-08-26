import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Decision = {
  syncPaymentId: string
  kind: 'tuition' | 'donation'
  // tuition
  feeType?: 'tuition' | 'building_fund' | 'registration_fee'
  tuitionPlanId?: string | null
  // donation
  category?: 'monthly_recurring' | 'one_time' | 'event'
  eventId?: string | null
}

type Body = { syncCustomerId: string; decisions: Decision[] }
type ResultStatus = 'imported' | 'merged' | 'needs_review' | 'failed'
type Result = { syncPaymentId: string; status: ResultStatus; reason?: string }

const monthKey = (d: string | null) => (d ? d.slice(0, 7) : null)

// Writes approved staged Sola payments into tuition_payments or donations,
// depending on each decision's kind. A batch can freely mix tuition and
// donation decisions for the same Sola customer (a parent can be both a
// tuition payer and a donor at once) — each is validated against the
// matching side of that customer's match state independently.
//
// Tuition: fuzzy-matches amount+month against existing not-yet-Sola-linked
// tuition_payments and merges rather than duplicating (see the dedup note
// below) — this is safe to do silently because a wrong tuition merge just
// means one payment record instead of two for what's almost certainly the
// same monthly charge.
//
// Donations: NEVER auto-merged or auto-skipped on a fuzzy match. A same
// donor+amount+month match is surfaced as 'needs_review' with a pointer to
// what it might duplicate, and stays there until a human resolves it via
// /api/sola/sync/resolve-duplicate — donations are one-off enough (a family
// could genuinely give twice in the same month for different reasons) that
// silent merging risks losing a real gift.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body?.syncCustomerId || !Array.isArray(body.decisions) || !body.decisions.length) {
    return NextResponse.json({ error: 'syncCustomerId and at least one decision are required.' }, { status: 400 })
  }

  const { data: syncCustomer } = await supabase.from('sola_sync_customers').select('*').eq('id', body.syncCustomerId).single()
  if (!syncCustomer) return NextResponse.json({ error: 'Sola sync customer not found.' }, { status: 404 })

  const studentId: string | null = syncCustomer.matched_student_id
  const donorId: string | null = syncCustomer.matched_donor_id

  const { data: studentPlans } = studentId
    ? await supabase.from('tuition_plans').select('id,student_id').eq('student_id', studentId)
    : { data: [] as { id: string; student_id: string }[] }
  const validPlanIds = new Set((studentPlans ?? []).map(p => p.id))

  // Fuzzy-merge candidate pool for tuition (see module comment). Not fetched
  // unless this batch actually contains a tuition decision.
  const needsTuitionPool = body.decisions.some(d => d.kind === 'tuition')
  const { data: unlinkedPayments } = needsTuitionPool && studentId
    ? await supabase.from('tuition_payments').select('id,amount,payment_date,created_at,payment_type,tuition_plan_id').eq('student_id', studentId).is('sola_transaction_id', null)
    : { data: [] as { id: string; amount: number; payment_date: string | null; created_at: string; payment_type: string | null; tuition_plan_id: string | null }[] }
  const tuitionCandidatePool = [...(unlinkedPayments ?? [])]

  const results: Result[] = []

  for (const decision of body.decisions) {
    const { data: payment } = await supabase.from('sola_sync_payments').select('*').eq('id', decision.syncPaymentId).eq('sola_sync_customer_id', body.syncCustomerId).single()
    if (!payment) { results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: 'Not found.' }); continue }
    if (payment.import_status !== 'pending') { results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: `Already ${payment.import_status}.` }); continue }
    if (payment.amount == null) { results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: 'No amount available for this payment (no matching schedule).' }); continue }

    const { data: dupTuition } = await supabase.from('tuition_payments').select('id').eq('sola_transaction_id', payment.sola_transaction_id).maybeSingle()
    const { data: dupDonation } = await supabase.from('donations').select('id').eq('sola_transaction_id', payment.sola_transaction_id).maybeSingle()
    if (dupTuition || dupDonation) {
      await supabase.from('sola_sync_payments').update({ import_status: 'duplicate', charge_kind: decision.kind }).eq('id', payment.id)
      results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: 'Already imported (duplicate).' })
      continue
    }

    if (decision.kind === 'tuition') {
      if (syncCustomer.match_status !== 'matched' || !studentId) {
        results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: 'This Sola customer must be a confirmed student match before importing tuition payments.' })
        continue
      }
      if (!decision.feeType) { results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: 'A fee type is required.' }); continue }
      const isRegFee = decision.feeType === 'registration_fee'
      if (!isRegFee && (!decision.tuitionPlanId || !validPlanIds.has(decision.tuitionPlanId))) {
        results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: 'A tuition plan on this student must be selected for tuition/building fund payments.' })
        continue
      }

      const fuzzyIdx = tuitionCandidatePool.findIndex(existing =>
        existing.payment_type === decision.feeType &&
        (isRegFee ? existing.tuition_plan_id == null : existing.tuition_plan_id === decision.tuitionPlanId) &&
        Number(existing.amount) === Number(payment.amount) &&
        monthKey(existing.payment_date) === monthKey(payment.transaction_date)
      )
      if (fuzzyIdx !== -1) {
        const existing = tuitionCandidatePool[fuzzyIdx]
        tuitionCandidatePool.splice(fuzzyIdx, 1)
        const looksLikeUnconsideredToday = existing.payment_date && existing.created_at && existing.payment_date === existing.created_at.slice(0, 10)
        const dateUpdated = !!(looksLikeUnconsideredToday && payment.transaction_date && existing.payment_date !== payment.transaction_date)
        const patch: Record<string, unknown> = { sola_transaction_id: payment.sola_transaction_id }
        if (dateUpdated) patch.payment_date = payment.transaction_date
        await supabase.from('tuition_payments').update(patch).eq('id', existing.id)
        await supabase.from('sola_sync_payments').update({ import_status: 'duplicate', charge_kind: 'tuition', tuition_payment_id: existing.id }).eq('id', payment.id)
        results.push({
          syncPaymentId: decision.syncPaymentId, status: 'merged',
          reason: dateUpdated
            ? `Matched an existing ${existing.payment_date} payment already on file — kept it as one payment and corrected its date to Sola's record (${payment.transaction_date}).`
            : 'Matched an existing payment already on file for the same month — kept it as one payment, no duplicate created.',
        })
        continue
      }

      const { data: inserted, error: insertError } = await supabase.from('tuition_payments').insert([{
        tuition_plan_id: isRegFee ? null : decision.tuitionPlanId,
        student_id: studentId, amount: payment.amount, payment_date: payment.transaction_date, status: 'paid',
        payment_type: decision.feeType, notes: 'Imported from Sola sync', sola_transaction_id: payment.sola_transaction_id,
      }]).select('id').single()
      if (insertError || !inserted) { results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: insertError?.message ?? 'Insert failed.' }); continue }

      if (isRegFee) {
        const { data: student } = await supabase.from('students').select('registration_fee_status').eq('id', studentId).single()
        if (!student?.registration_fee_status) {
          // Charge whatever was actually paid, not a hardcoded rate — the
          // registration fee amount has changed over time (was a flat $250,
          // now $75/$50 depending on when it's paid), and this import path
          // handles both old and new Sola history.
          await supabase.from('students').update({ registration_fee_status: 'pending', registration_fee_amount: payment.amount }).eq('id', studentId)
        }
      }
      await supabase.from('sola_sync_payments').update({ import_status: 'imported', charge_kind: 'tuition', tuition_payment_id: inserted.id }).eq('id', payment.id)
      results.push({ syncPaymentId: decision.syncPaymentId, status: 'imported' })
      continue
    }

    // decision.kind === 'donation'
    if (syncCustomer.donor_match_status !== 'matched' || !donorId) {
      results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: 'This Sola customer must be a confirmed donor match before importing donations.' })
      continue
    }
    if (!decision.category) { results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: 'A donation category is required.' }); continue }
    if (decision.category === 'event' && !decision.eventId) { results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: 'An event must be selected for event donations.' }); continue }

    const { data: possibleDup } = await supabase
      .from('donations').select('id,amount,donation_date')
      .eq('donor_id', donorId).is('sola_transaction_id', null)
    const dupMatch = (possibleDup ?? []).find(d => Number(d.amount) === Number(payment.amount) && monthKey(d.donation_date) === monthKey(payment.transaction_date))
    if (dupMatch) {
      await supabase.from('sola_sync_payments').update({
        import_status: 'needs_review', charge_kind: 'donation', duplicate_of_donation_id: dupMatch.id,
        resolved_category: decision.category, resolved_event_id: decision.eventId ?? null,
      }).eq('id', payment.id)
      results.push({
        syncPaymentId: decision.syncPaymentId, status: 'needs_review',
        reason: `Looks like it might be the same as an existing ${formatMoney(dupMatch.amount)} donation on ${dupMatch.donation_date} — resolve in the Duplicate Donations review below.`,
      })
      continue
    }

    const { data: insertedDonation, error: donationError } = await supabase.from('donations').insert([{
      donor_id: donorId, amount: payment.amount, donation_method: 'Online Payment', donation_date: payment.transaction_date,
      purpose: 'General Fund', category: decision.category, event_id: decision.eventId ?? null, source: 'sola',
      sola_transaction_id: payment.sola_transaction_id, notes: 'Imported from Sola sync',
    }]).select('id').single()
    if (donationError || !insertedDonation) { results.push({ syncPaymentId: decision.syncPaymentId, status: 'failed', reason: donationError?.message ?? 'Insert failed.' }); continue }

    await supabase.from('sola_sync_payments').update({
      import_status: 'imported', charge_kind: 'donation', donation_id: insertedDonation.id,
      resolved_category: decision.category, resolved_event_id: decision.eventId ?? null,
    }).eq('id', payment.id)
    results.push({ syncPaymentId: decision.syncPaymentId, status: 'imported' })
  }

  // The tuition side has a 'merged' state to reach once nothing's pending;
  // the donor side doesn't need one — 'matched' already means "confirmed,"
  // independent of whether every donation under it has been resolved yet.
  const { count: pendingTuition } = await supabase
    .from('sola_sync_payments').select('id', { count: 'exact', head: true })
    .eq('sola_sync_customer_id', body.syncCustomerId).eq('import_status', 'pending').eq('charge_kind', 'tuition')
  if (!pendingTuition && syncCustomer.match_status === 'matched') {
    await supabase.from('sola_sync_customers').update({ match_status: 'merged' }).eq('id', body.syncCustomerId)
  }

  const { data: statusCounts } = await supabase.from('sola_sync_customers').select('match_status,donor_match_status')
  const summary = { matched: 0, needs_review: 0, unmatched: 0, not_a_student: 0, merged: 0 }
  const donorSummary = { matched: 0, needs_review: 0, unmatched: 0, not_a_donor: 0 }
  for (const r of statusCounts ?? []) {
    if (r.match_status in summary) (summary as Record<string, number>)[r.match_status]++
    if (r.donor_match_status in donorSummary) (donorSummary as Record<string, number>)[r.donor_match_status]++
  }

  return NextResponse.json({ results, summary, donorSummary })
}

function formatMoney(n: number) {
  return `$${Number(n).toFixed(2)}`
}
