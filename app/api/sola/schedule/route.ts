import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createSchedule, cancelSchedule, isTestMode } from '@/lib/sola/client'
import { resolveSolaCustomer, resolvePaymentMethod, type NewPaymentMethodInput } from '@/lib/sola/context'

type ScheduleBody = {
  type: 'student' | 'donor'
  id: string
  amount: number
  purpose: 'tuition' | 'building_fund' | 'donation' | 'phone_charge'
  intervalType: 'day' | 'week' | 'month' | 'year'
  intervalCount: number
  totalPayments?: number       // omitted = open-ended recurring; set = payment plan/installments
  startDate: string
  paymentMethodId?: string
  newPaymentMethod?: NewPaymentMethodInput
  // Direct Sola PaymentMethodId, bypassing local resolution entirely — used
  // for the "retry a declined one-time charge in N days" flow, where the
  // family's payment method was already tokenized (and possibly declined)
  // moments earlier and re-tokenizing would fail (iFields tokens are
  // single-use). Not raw payment data — just Sola's own reference.
  solaPaymentMethodId?: string
  save?: boolean
  daysBetweenRetries?: number
  failedTransactionRetryTimes?: number
}

// One-time charges use ProcessTransaction directly; recurring donations and
// tuition payment plans both use the same Sola primitive (CreateSchedule) —
// the only difference is whether totalPayments is set.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as ScheduleBody | null
  if (!body || (body.type !== 'student' && body.type !== 'donor') || !body.id || !(body.amount > 0)
    || !body.purpose || !body.intervalType || !body.intervalCount || !body.startDate) {
    return NextResponse.json({ error: 'type, id, amount, purpose, intervalType, intervalCount, and startDate are required.' }, { status: 400 })
  }
  if (!body.paymentMethodId && !body.newPaymentMethod && !body.solaPaymentMethodId) {
    return NextResponse.json({ error: 'paymentMethodId, newPaymentMethod, or solaPaymentMethodId is required.' }, { status: 400 })
  }

  const customer = await resolveSolaCustomer(supabase, body.type, body.id)
  if (!customer.ok) return NextResponse.json({ error: customer.error }, { status: 404 })

  const method = body.solaPaymentMethodId
    ? { ok: true as const, solaPaymentMethodId: body.solaPaymentMethodId, localPaymentMethodId: null }
    : await resolvePaymentMethod(supabase, {
        type: body.type,
        id: body.id,
        solaCustomerId: customer.solaCustomerId,
        paymentMethodId: body.paymentMethodId,
        newPaymentMethod: body.newPaymentMethod,
        save: body.save,
      })
  if (!method.ok) return NextResponse.json({ error: method.error }, { status: 502 })

  // Custom01 carries context back to us on every webhook event this schedule
  // generates, since those charges happen on Sola's own clock, not a request
  // we initiate — this is how the webhook knows which CRM record/purpose to
  // credit.
  const custom01 = JSON.stringify({ type: body.type, id: body.id, purpose: body.purpose })

  const created = await createSchedule({
    customerId: customer.solaCustomerId,
    paymentMethodId: method.solaPaymentMethodId,
    amount: body.amount,
    intervalType: body.intervalType,
    intervalCount: body.intervalCount,
    totalPayments: body.totalPayments,
    startDate: body.startDate,
    custom01,
    daysBetweenRetries: body.daysBetweenRetries,
    failedTransactionRetryTimes: body.failedTransactionRetryTimes,
  })
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 502 })

  const testMode = await isTestMode()
  const { data: scheduleRow, error: insertError } = await supabase
    .from('payment_schedules')
    .insert([{
      student_id: body.type === 'student' ? body.id : null,
      donor_id: body.type === 'donor' ? body.id : null,
      payment_method_id: method.localPaymentMethodId,
      sola_schedule_id: created.scheduleId,
      purpose: body.purpose,
      amount: body.amount,
      interval_type: body.intervalType,
      interval_count: body.intervalCount,
      total_payments: body.totalPayments ?? null,
      start_date: body.startDate,
    }])
    .select('id')
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  return NextResponse.json({ scheduleId: scheduleRow.id, solaScheduleId: created.scheduleId, isTest: testMode })
}

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })

  const { data: schedule, error: fetchError } = await supabase
    .from('payment_schedules').select('sola_schedule_id').eq('id', id).single()
  if (fetchError || !schedule) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 })

  // Simulated schedules (created while test mode was on) never existed in
  // Sola, so there's nothing to cancel there — just mark it cancelled locally.
  if (!schedule.sola_schedule_id.startsWith('TEST-SCHED-')) {
    const cancelled = await cancelSchedule(schedule.sola_schedule_id)
    if (!cancelled.ok) return NextResponse.json({ error: cancelled.error }, { status: 502 })
  }

  const { error: updateError } = await supabase.from('payment_schedules').update({ status: 'cancelled' }).eq('id', id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ cancelled: true })
}
