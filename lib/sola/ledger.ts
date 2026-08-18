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

// A donation charged from a student's own tuition page still has to land on
// a real donor record (donations.donor_id is required) — reuses an already
// linked donor (donor_students) if one exists, or creates one on the fly
// from the family's own info, the same "sync on first use" pattern already
// used for Sola customers (see resolveSolaCustomer in context.ts).
async function findOrCreateLinkedDonor(
  supabase: AnySupabaseClient,
  studentId: string
): Promise<{ id: string } | { error: string }> {
  const { data: links } = await supabase
    .from('donor_students').select('donor_id').eq('student_id', studentId).limit(1)
  if (links && links.length) return { id: links[0].donor_id as string }

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('last_name,parents_title,father_name,mother_name,father_email,mother_email')
    .eq('id', studentId)
    .single()
  if (studentError || !student) return { error: studentError?.message || 'Student not found' }

  const name = student.parents_title
    ? `${student.parents_title} ${student.last_name}`
    : student.father_name || student.mother_name || `${student.last_name} Family`

  const { data: donor, error: donorError } = await supabase
    .from('donors')
    .insert([{ name, email: student.father_email || student.mother_email || null }])
    .select('id')
    .single()
  if (donorError || !donor) return { error: donorError?.message || 'Failed to create donor record' }

  await supabase.from('donor_students').insert([{ donor_id: donor.id, student_id: studentId }])
  return { id: donor.id as string }
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
  } else if (opts.type === 'student' && opts.purpose === 'donation') {
    const donor = await findOrCreateLinkedDonor(supabase, opts.id)
    if ('error' in donor) return { warning: `Charge succeeded, but couldn't attribute it to a donor record: ${donor.error} — record it manually.` }
    await supabase.from('donations').insert([{
      donor_id: donor.id,
      amount: opts.amount,
      donation_method: label,
      donation_date: new Date().toISOString().slice(0, 10),
      purpose: 'General',
      notes: refNote,
    }])
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
