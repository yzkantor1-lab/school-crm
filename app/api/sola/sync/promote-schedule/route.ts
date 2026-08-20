import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getScheduleRaw, tagScheduleCustom02 } from '@/lib/sola/client'

type Body = { syncScheduleId: string }

// "Track as Recurring" for a Sola-native schedule (one set up directly in
// Sola, not through the CRM): stamps the live Sola schedule's Custom02 with
// the same {type,id,purpose} tag CreateSchedule attaches to CRM-created
// schedules (so future webhook charges get real-time attribution — see
// tagScheduleCustom02 in lib/sola/client.ts), and mirrors it into
// payment_schedules so it shows on the student's tuition page like any other
// recurring plan. Requires a default_purpose already set (via
// /api/sola/sync/set-default) and the customer already matched to the
// student/donor that purpose implies.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body?.syncScheduleId) return NextResponse.json({ error: 'syncScheduleId is required.' }, { status: 400 })

  const { data: syncSchedule } = await supabase
    .from('sola_sync_schedules').select('*').eq('id', body.syncScheduleId).single()
  if (!syncSchedule) return NextResponse.json({ error: 'Sola sync schedule not found.' }, { status: 404 })
  if (syncSchedule.linked_payment_schedule_id) {
    return NextResponse.json({ error: 'This schedule is already tracked as recurring.' }, { status: 400 })
  }
  if (!syncSchedule.default_purpose) {
    return NextResponse.json({ error: 'Set a default purpose for this schedule first.' }, { status: 400 })
  }
  if (syncSchedule.default_purpose === 'registration_fee') {
    return NextResponse.json({ error: 'Registration Fee is a one-time charge, not a recurring purpose — pick Tuition, Building Fund, or Donation.' }, { status: 400 })
  }
  const purpose = syncSchedule.default_purpose as 'tuition' | 'building_fund' | 'donation'

  const { data: syncCustomer } = await supabase
    .from('sola_sync_customers').select('matched_student_id,matched_donor_id').eq('id', syncSchedule.sola_sync_customer_id).single()
  if (!syncCustomer) return NextResponse.json({ error: 'Sola sync customer not found.' }, { status: 404 })

  const type = purpose === 'donation' ? 'donor' : 'student'
  const ownerId = type === 'donor' ? syncCustomer.matched_donor_id : syncCustomer.matched_student_id
  if (!ownerId) {
    return NextResponse.json({
      error: type === 'donor' ? 'Match this customer to a donor first.' : 'Match this customer to a student first.',
    }, { status: 400 })
  }

  const raw = await getScheduleRaw(syncSchedule.sola_schedule_id)
  if (!raw) return NextResponse.json({ error: 'Schedule not found in Sola.' }, { status: 404 })

  const intervalType = raw.IntervalType.toLowerCase()
  if (!['day', 'week', 'month', 'year'].includes(intervalType)) {
    return NextResponse.json({ error: `Unrecognized interval type from Sola: ${raw.IntervalType}` }, { status: 502 })
  }

  const custom02 = JSON.stringify({ type, id: ownerId, purpose })
  const tagged = await tagScheduleCustom02(syncSchedule.sola_schedule_id, custom02)
  if (!tagged.ok) return NextResponse.json({ error: tagged.error }, { status: 502 })

  const { data: scheduleRow, error: insertError } = await supabase
    .from('payment_schedules')
    .insert([{
      student_id: type === 'student' ? ownerId : null,
      donor_id: type === 'donor' ? ownerId : null,
      sola_schedule_id: syncSchedule.sola_schedule_id,
      purpose,
      amount: raw.Amount,
      interval_type: intervalType,
      interval_count: raw.IntervalCount,
      total_payments: raw.TotalPayments ?? null,
      start_date: raw.StartDate,
    }])
    .select('id')
    .single()
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  await supabase.from('sola_sync_schedules').update({ linked_payment_schedule_id: scheduleRow.id }).eq('id', syncSchedule.id)

  return NextResponse.json({ ok: true, paymentScheduleId: scheduleRow.id })
}
