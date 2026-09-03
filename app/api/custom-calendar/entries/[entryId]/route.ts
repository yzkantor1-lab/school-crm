import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createSchedule, cancelSchedule, listAllSchedules } from '@/lib/sola/client'
import { resolveSolaCustomer, resolvePaymentMethod } from '@/lib/sola/context'

type PatchBody = { amount?: number; periodDate?: string }

// Whether the one-shot schedule behind an auto_charge entry has already
// fired — if it has, the entry is locked (nothing left to edit/cancel, the
// charge already happened); if not, editing means cancelling that schedule
// and creating a fresh one-shot at the new amount/date, same "no partial
// update" constraint as every other schedule change in this app.
async function alreadyProcessed(solaScheduleId: string): Promise<boolean> {
  if (solaScheduleId.startsWith('TEST-SCHED-')) return false
  const all = await listAllSchedules()
  const live = all.find(s => s.scheduleId === solaScheduleId)
  return (live?.paymentsProcessed ?? 0) > 0
}

export async function PATCH(req: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId } = await params
  const body = (await req.json().catch(() => null)) as PatchBody | null
  if (!body || (body.amount === undefined && body.periodDate === undefined)) {
    return NextResponse.json({ error: 'amount and/or periodDate is required.' }, { status: 400 })
  }
  if (body.amount !== undefined && !(body.amount > 0)) {
    return NextResponse.json({ error: 'amount must be positive.' }, { status: 400 })
  }

  const { data: entry, error: entryError } = await supabase.from('custom_payment_calendar_entries')
    .select('*, custom_payment_calendars(student_id, donor_id, purpose, mode)').eq('id', entryId).single()
  if (entryError || !entry) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })
  if (entry.status === 'cancelled') return NextResponse.json({ error: 'This entry was already cancelled.' }, { status: 400 })

  const calendar = entry.custom_payment_calendars as { student_id: string | null; donor_id: string | null; purpose: string; mode: string }
  const nextAmount = body.amount ?? Number(entry.amount)
  const nextPeriodDate = body.periodDate ?? entry.period_date

  if (calendar.mode === 'planning_only' || !entry.payment_schedule_id) {
    const { error } = await supabase.from('custom_payment_calendar_entries')
      .update({ amount: nextAmount, period_date: nextPeriodDate }).eq('id', entryId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const { data: schedule } = await supabase.from('payment_schedules')
    .select('sola_schedule_id, payment_method_id').eq('id', entry.payment_schedule_id).single()
  if (!schedule) return NextResponse.json({ error: 'Underlying schedule not found.' }, { status: 404 })

  if (await alreadyProcessed(schedule.sola_schedule_id)) {
    return NextResponse.json({ error: 'This charge already went through — nothing left to edit.' }, { status: 400 })
  }

  if (!schedule.sola_schedule_id.startsWith('TEST-SCHED-')) {
    const cancelled = await cancelSchedule(schedule.sola_schedule_id)
    if (!cancelled.ok) return NextResponse.json({ error: `Could not update: ${cancelled.error}` }, { status: 502 })
  }
  await supabase.from('payment_schedules').update({ status: 'cancelled' }).eq('id', entry.payment_schedule_id)

  const ownerType = calendar.student_id ? 'student' : 'donor'
  const ownerId = calendar.student_id ?? calendar.donor_id!
  const customer = await resolveSolaCustomer(supabase, ownerType, ownerId)
  if (!customer.ok) return NextResponse.json({ error: customer.error }, { status: 404 })
  const method = await resolvePaymentMethod(supabase, {
    type: ownerType, id: ownerId, solaCustomerId: customer.solaCustomerId, paymentMethodId: schedule.payment_method_id ?? undefined,
  })
  if (!method.ok) return NextResponse.json({ error: method.error }, { status: 502 })

  const created = await createSchedule({
    customerId: customer.solaCustomerId,
    paymentMethodId: method.solaPaymentMethodId,
    amount: nextAmount,
    intervalType: 'month',
    intervalCount: 1,
    totalPayments: 1,
    startDate: nextPeriodDate,
    custom02: JSON.stringify({ type: ownerType, id: ownerId, purpose: calendar.purpose }),
  })
  if (!created.ok) {
    return NextResponse.json({
      error: `The old charge was cancelled, but creating the new one failed: ${created.error}. This period has no schedule now — edit it again to set one up.`,
    }, { status: 502 })
  }

  const { data: newScheduleRow } = await supabase.from('payment_schedules').insert([{
    student_id: calendar.student_id, donor_id: calendar.donor_id, payment_method_id: method.localPaymentMethodId,
    sola_schedule_id: created.scheduleId, purpose: calendar.purpose, amount: nextAmount,
    interval_type: 'month', interval_count: 1, total_payments: 1, start_date: nextPeriodDate,
  }]).select('id').single()

  const { error: updateError } = await supabase.from('custom_payment_calendar_entries')
    .update({ amount: nextAmount, period_date: nextPeriodDate, payment_schedule_id: newScheduleRow?.id ?? null, status: 'scheduled' })
    .eq('id', entryId)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId } = await params
  const { data: entry, error: entryError } = await supabase.from('custom_payment_calendar_entries')
    .select('*').eq('id', entryId).single()
  if (entryError || !entry) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })

  if (entry.payment_schedule_id) {
    const { data: schedule } = await supabase.from('payment_schedules')
      .select('sola_schedule_id').eq('id', entry.payment_schedule_id).single()
    if (schedule) {
      if (await alreadyProcessed(schedule.sola_schedule_id)) {
        return NextResponse.json({ error: 'This charge already went through — nothing left to cancel.' }, { status: 400 })
      }
      if (!schedule.sola_schedule_id.startsWith('TEST-SCHED-')) {
        const cancelled = await cancelSchedule(schedule.sola_schedule_id)
        if (!cancelled.ok) return NextResponse.json({ error: cancelled.error }, { status: 502 })
      }
      await supabase.from('payment_schedules').update({ status: 'cancelled' }).eq('id', entry.payment_schedule_id)
    }
  }

  const { error } = await supabase.from('custom_payment_calendar_entries').update({ status: 'cancelled' }).eq('id', entryId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
