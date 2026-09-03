import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cancelSchedule, listAllSchedules } from '@/lib/sola/client'

export async function DELETE(req: Request, { params }: { params: Promise<{ calendarId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { calendarId } = await params
  const { data: entries, error: entriesError } = await supabase.from('custom_payment_calendar_entries')
    .select('id, payment_schedule_id, status').eq('calendar_id', calendarId).neq('status', 'cancelled')
  if (entriesError) return NextResponse.json({ error: entriesError.message }, { status: 500 })

  const scheduleIds = (entries ?? []).map(e => e.payment_schedule_id).filter((id): id is string => !!id)
  const schedules = scheduleIds.length
    ? (await supabase.from('payment_schedules').select('id, sola_schedule_id').in('id', scheduleIds)).data ?? []
    : []
  const live = scheduleIds.length ? await listAllSchedules() : []

  const failed: string[] = []
  for (const s of schedules) {
    const stillLive = live.find(l => l.scheduleId === s.sola_schedule_id)
    // Already fired (paymentsProcessed > 0) — nothing to cancel, just leave
    // it and its entry as-is rather than error the whole calendar cancel
    // over a period that already got charged.
    if ((stillLive?.paymentsProcessed ?? 0) > 0) continue
    if (!s.sola_schedule_id.startsWith('TEST-SCHED-')) {
      const cancelled = await cancelSchedule(s.sola_schedule_id)
      if (!cancelled.ok) { failed.push(s.sola_schedule_id); continue }
    }
    await supabase.from('payment_schedules').update({ status: 'cancelled' }).eq('id', s.id)
  }

  await supabase.from('custom_payment_calendar_entries')
    .update({ status: 'cancelled' })
    .in('id', (entries ?? []).map(e => e.id))
  await supabase.from('custom_payment_calendars').update({ status: 'cancelled' }).eq('id', calendarId)

  if (failed.length) {
    return NextResponse.json({ ok: true, warning: `${failed.length} schedule(s) could not be stopped with Sola and may still be active — check them individually.` })
  }
  return NextResponse.json({ ok: true })
}
