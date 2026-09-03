import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createSchedule, cancelSchedule } from '@/lib/sola/client'
import { resolveSolaCustomer, resolvePaymentMethod, type OwnerType } from '@/lib/sola/context'

type CalendarPurpose = 'tuition' | 'building_fund' | 'phone_charge' | 'donation'

type CreateBody = {
  type: OwnerType
  id: string
  purpose: CalendarPurpose
  mode: 'auto_charge' | 'planning_only'
  paymentMethodId?: string   // required for auto_charge
  cancelScheduleId?: string  // an existing flat recurring schedule (local payment_schedules.id) to stop first
  entries: { periodDate: string; amount: number }[]
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const studentId = searchParams.get('studentId')
  const donorId = searchParams.get('donorId')
  if (!studentId && !donorId) return NextResponse.json({ error: 'studentId or donorId is required.' }, { status: 400 })

  let q = supabase.from('custom_payment_calendars')
    .select('*, custom_payment_calendar_entries(*)')
    .order('created_at', { ascending: false })
  q = studentId ? q.eq('student_id', studentId) : q.eq('donor_id', donorId!)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

// Creates a calendar of per-period amounts. In auto_charge mode this also
// cancels whatever flat recurring schedule was passed in (same "stop the
// old one first" pattern as Recalculate) and creates one one-time
// (TotalPayments=1) Sola schedule per entry — Sola has no "different amount
// each occurrence" primitive, so a variable-amount plan is really N
// separate one-shot schedules under the hood, each firing on its own date.
// planning_only never touches Sola at all; entries just sit as a reference
// grid staff fills expected amounts into and charges/records manually.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as CreateBody | null
  if (!body || (body.type !== 'student' && body.type !== 'donor') || !body.id || !body.purpose
    || (body.mode !== 'auto_charge' && body.mode !== 'planning_only') || !Array.isArray(body.entries) || !body.entries.length) {
    return NextResponse.json({ error: 'type, id, purpose, mode, and at least one entry are required.' }, { status: 400 })
  }
  for (const e of body.entries) {
    if (!e.periodDate || !(e.amount > 0)) {
      return NextResponse.json({ error: 'Every entry needs a periodDate and a positive amount.' }, { status: 400 })
    }
  }
  if (body.mode === 'auto_charge' && !body.paymentMethodId) {
    return NextResponse.json({ error: 'paymentMethodId is required for an auto-charging calendar.' }, { status: 400 })
  }

  if (body.cancelScheduleId) {
    const { data: existing } = await supabase.from('payment_schedules')
      .select('sola_schedule_id').eq('id', body.cancelScheduleId).single()
    if (existing && !existing.sola_schedule_id.startsWith('TEST-SCHED-')) {
      const cancelled = await cancelSchedule(existing.sola_schedule_id)
      if (!cancelled.ok) return NextResponse.json({ error: `Could not stop the existing recurring charge: ${cancelled.error}` }, { status: 502 })
    }
    if (existing) await supabase.from('payment_schedules').update({ status: 'cancelled' }).eq('id', body.cancelScheduleId)
  }

  const { data: calendar, error: calendarError } = await supabase.from('custom_payment_calendars')
    .insert([{
      student_id: body.type === 'student' ? body.id : null,
      donor_id: body.type === 'donor' ? body.id : null,
      purpose: body.purpose,
      mode: body.mode,
      payment_method_id: body.paymentMethodId ?? null,
    }])
    .select('id').single()
  if (calendarError || !calendar) return NextResponse.json({ error: calendarError?.message || 'Failed to create calendar.' }, { status: 500 })

  if (body.mode === 'planning_only') {
    const { error: entriesError } = await supabase.from('custom_payment_calendar_entries').insert(
      body.entries.map(e => ({ calendar_id: calendar.id, period_date: e.periodDate, amount: e.amount, status: 'planned' }))
    )
    if (entriesError) return NextResponse.json({ error: entriesError.message }, { status: 500 })
    return NextResponse.json({ calendarId: calendar.id, scheduled: 0, failed: [] })
  }

  // auto_charge: resolve the customer/payment method once, reuse across
  // every one-shot schedule rather than re-resolving per entry.
  const customer = await resolveSolaCustomer(supabase, body.type, body.id)
  if (!customer.ok) return NextResponse.json({ error: customer.error }, { status: 404 })
  const method = await resolvePaymentMethod(supabase, {
    type: body.type, id: body.id, solaCustomerId: customer.solaCustomerId, paymentMethodId: body.paymentMethodId,
  })
  if (!method.ok) return NextResponse.json({ error: method.error }, { status: 502 })

  const failed: { periodDate: string; amount: number; error: string }[] = []
  // Sequential, not parallel — keeps this predictable against Sola and
  // keeps failures attributable to a specific entry rather than a jumbled
  // race, for what's usually a small handful of calls (a school year's
  // worth of months).
  for (const e of body.entries) {
    const custom02 = JSON.stringify({ type: body.type, id: body.id, purpose: body.purpose })
    const created = await createSchedule({
      customerId: customer.solaCustomerId,
      paymentMethodId: method.solaPaymentMethodId,
      amount: e.amount,
      intervalType: 'month',
      intervalCount: 1,
      totalPayments: 1,
      startDate: e.periodDate,
      custom02,
    })
    if (!created.ok) {
      failed.push({ periodDate: e.periodDate, amount: e.amount, error: created.error })
      await supabase.from('custom_payment_calendar_entries').insert([{
        calendar_id: calendar.id, period_date: e.periodDate, amount: e.amount, status: 'planned',
        notes: `Sola schedule creation failed: ${created.error}`,
      }])
      continue
    }
    const { data: scheduleRow } = await supabase.from('payment_schedules').insert([{
      student_id: body.type === 'student' ? body.id : null,
      donor_id: body.type === 'donor' ? body.id : null,
      payment_method_id: method.localPaymentMethodId,
      sola_schedule_id: created.scheduleId,
      purpose: body.purpose,
      amount: e.amount,
      interval_type: 'month',
      interval_count: 1,
      total_payments: 1,
      start_date: e.periodDate,
    }]).select('id').single()
    await supabase.from('custom_payment_calendar_entries').insert([{
      calendar_id: calendar.id, period_date: e.periodDate, amount: e.amount, status: 'scheduled',
      payment_schedule_id: scheduleRow?.id ?? null,
    }])
  }

  return NextResponse.json({ calendarId: calendar.id, scheduled: body.entries.length - failed.length, failed })
}
