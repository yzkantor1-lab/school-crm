import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Body = {
  target: 'customer' | 'schedule'
  id: string
  purpose: 'tuition' | 'building_fund' | 'registration_fee' | 'donation' | null
  donationCategory?: 'monthly_recurring' | 'one_time' | 'event' | null
  tuitionPlanId?: string | null
}

// Sets (or clears, via purpose: null) a default categorization on a
// sola_sync_customers or sola_sync_schedules row — a Sola account/schedule
// that was set up directly in Sola, without the CRM's own createSchedule
// tagging it with a purpose. Once set, future Sola Sync pulls apply it to
// newly-staged payments instead of leaving them 'ambiguous' (see
// classifyPayment in app/api/sola/sync/run/route.ts). Payments already
// staged before the default was set are never touched — this only changes
// how new rows get classified going forward.
//
// Schedule-level tuition/building_fund defaults also pin which tuition plan
// the schedule belongs to (tuitionPlanId) — not just the fee type. Once both
// are set, the import route treats every future payment from that exact
// schedule as fully confirmed by identity and skips the date-proximity
// duplicate check entirely (see isScheduleConfirmed in
// app/api/sola/sync/import/route.ts) — this is the "ask once" a family with
// no predictable payment date needs, since schedule identity is a stronger
// signal than any date guess could be. Customer-level defaults (no schedule
// behind them) never carry a plan — those payments still need a plan picked
// per payment, same as before.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body || (body.target !== 'customer' && body.target !== 'schedule') || !body.id) {
    return NextResponse.json({ error: 'target and id are required.' }, { status: 400 })
  }
  if (body.purpose === 'donation' && body.donationCategory && !['monthly_recurring', 'one_time', 'event'].includes(body.donationCategory)) {
    return NextResponse.json({ error: 'Invalid donationCategory.' }, { status: 400 })
  }

  const table = body.target === 'customer' ? 'sola_sync_customers' : 'sola_sync_schedules'
  const update: Record<string, unknown> = {
    default_purpose: body.purpose,
    default_donation_category: body.purpose === 'donation' ? (body.donationCategory ?? 'one_time') : null,
  }
  if (body.target === 'schedule') {
    update.default_tuition_plan_id = (body.purpose === 'tuition' || body.purpose === 'building_fund') ? (body.tuitionPlanId ?? null) : null
  }

  const { error } = await supabase.from(table).update(update).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
