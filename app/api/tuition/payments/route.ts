import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type TuitionPayment = { id: string; tuition_plan_id: string; amount: number; status: string; payment_type: string | null }

// Runs server-side so the browser never talks to Supabase's REST API directly
// for this endpoint — some ad blockers / privacy extensions block requests
// whose URL contains "payment", which was silently killing the client-side
// fetch to /rest/v1/tuition_payments (while sibling requests to /students,
// /tuition_plans went through fine on the same page).
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
      .select('id,tuition_plan_id,amount,status,payment_type')
      .eq('status', 'paid')
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
