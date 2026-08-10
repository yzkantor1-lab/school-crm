import type { SupabaseClient } from '@supabase/supabase-js'

// Loosely typed so it accepts either the cookie-based server client
// (lib/supabase/server.ts) or the service-role admin client
// (lib/supabase/admin.ts) — both expose the same .from(table) surface used
// here, and this runs from both the synchronous charge route and the
// webhook receiver (which has no logged-in user, so it must use the admin
// client).
type AnySupabaseClient = Pick<SupabaseClient, 'from'>

// Latest-academic-year plan, ties broken by 'active' status — same rule used
// on the tuition list/detail pages for "which plan is the current one."
export async function findLatestPlan(
  supabase: AnySupabaseClient,
  studentId: string
): Promise<{ id: string } | null> {
  const { data: plans } = await supabase
    .from('tuition_plans')
    .select('id,academic_year,status')
    .eq('student_id', studentId)
  if (!plans || !plans.length) return null
  const sorted = [...plans].sort((a, b) => {
    const yearCmp = (b.academic_year || '').localeCompare(a.academic_year || '')
    if (yearCmp !== 0) return yearCmp
    return (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
  })
  return sorted[0]
}

export function methodLabel(methodType: 'card' | 'ach') {
  return methodType === 'ach' ? 'bank_transfer' : 'credit_card'
}

// Credits an approved Sola charge into the same tables the rest of the CRM
// already reads balances from (tuition_payments/donations/registration fee)
// — used by both the synchronous one-time-charge route and the webhook
// receiver (for schedule-driven charges that happen on Sola's own clock).
export async function recordApprovedCharge(
  supabase: AnySupabaseClient,
  opts: {
    type: 'student' | 'donor'
    id: string
    amount: number
    purpose: string
    methodType: 'card' | 'ach'
    refNum: string
    isTest: boolean
  }
): Promise<{ warning?: string }> {
  const refNote = `Sola charge — ref ${opts.refNum}${opts.isTest ? ' [TEST MODE]' : ''}`
  const label = methodLabel(opts.methodType)

  if (opts.type === 'student' && (opts.purpose === 'tuition' || opts.purpose === 'building_fund')) {
    const plan = await findLatestPlan(supabase, opts.id)
    if (!plan) return { warning: 'Charge succeeded, but this student has no tuition plan to attach it to — record it manually.' }
    await supabase.from('tuition_payments').insert([{
      tuition_plan_id: plan.id,
      student_id: opts.id,
      amount: opts.amount,
      payment_date: new Date().toISOString().slice(0, 10),
      status: 'paid',
      payment_method: label,
      payment_type: opts.purpose,
      notes: refNote,
    }])
  } else if (opts.type === 'student' && opts.purpose === 'phone_charge') {
    // Plan-independent, like registration_fee — the recurring schedule (not
    // any tuition_plan) is what determines whether this keeps billing.
    await supabase.from('tuition_payments').insert([{
      tuition_plan_id: null,
      student_id: opts.id,
      amount: opts.amount,
      payment_date: new Date().toISOString().slice(0, 10),
      status: 'paid',
      payment_method: label,
      payment_type: 'phone_charge',
      notes: refNote,
    }])
  } else if (opts.type === 'student' && opts.purpose === 'registration_fee') {
    const today = new Date().toISOString().slice(0, 10)
    // Registration fee balance/status is now derived from tuition_payments
    // (same as tuition/building fund) so it supports partial payments —
    // insert a real payment row, and keep the flat student columns as a
    // convenience mirror for the "has a fee been queued" check.
    await supabase.from('tuition_payments').insert([{
      tuition_plan_id: null,
      student_id: opts.id,
      amount: opts.amount,
      payment_date: today,
      status: 'paid',
      payment_method: label,
      payment_type: 'registration_fee',
      notes: refNote,
    }])
    await supabase.from('students').update({
      registration_fee_status: 'paid',
      registration_fee_paid_date: today,
    }).eq('id', opts.id)
  } else if (opts.type === 'donor') {
    await supabase.from('donations').insert([{
      donor_id: opts.id,
      amount: opts.amount,
      donation_method: label,
      donation_date: new Date().toISOString().slice(0, 10),
      purpose: 'General',
      notes: refNote,
    }])
  }

  return {}
}
