import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type TuitionPayment = { id: string; tuition_plan_id: string; amount: number; status: string; payment_type: string | null; payment_date: string | null }

// Runs server-side so the browser never talks to Supabase's REST API directly
// for this data — some content filters (school/office network-level ad and
// content blockers, e.g. the one that surfaced this: a "GenTech BlockPage")
// block any request whose URL contains "payment", regardless of which
// server ultimately answers it. This route used to be named
// /api/tuition/payments, which still tripped the exact same filter — moving
// the request off Supabase's domain wasn't enough on its own; the URL text
// itself has to avoid the trigger word. Kept as "records" here specifically
// so a future rename doesn't accidentally reintroduce "payment"/"payments"
// into the path.
export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageSize = 200
  const all: TuitionPayment[] = []
  let cursor = '00000000-0000-0000-0000-000000000000'
  while (true) {
    const { data, error } = await supabase
      .from('tuition_payments')
      .select('id,tuition_plan_id,amount,status,payment_type,payment_date')
      .in('status', ['paid', 'partial', 'forgiven'])
      .in('payment_type', ['tuition', 'building_fund'])
      .gt('id', cursor)
      .order('id')
      .limit(pageSize)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const page = (data || []) as TuitionPayment[]
    all.push(...page)
    if (page.length < pageSize) break
    cursor = page[page.length - 1].id
  }

  return NextResponse.json(all)
}
