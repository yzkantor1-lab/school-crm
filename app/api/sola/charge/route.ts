import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processTransaction, isTestMode } from '@/lib/sola/client'
import { resolveSolaCustomer, resolvePaymentMethod, methodLabel, type NewPaymentMethodInput } from '@/lib/sola/context'

type ChargeBody = {
  type: 'student' | 'donor'
  id: string
  amount: number
  purpose: 'tuition' | 'building_fund' | 'registration_fee' | 'donation'
  paymentMethodId?: string
  newPaymentMethod?: NewPaymentMethodInput
  save?: boolean
}

// Latest-academic-year plan, ties broken by 'active' status — same rule used
// on the tuition list/detail pages for "which plan is the current one."
async function findLatestPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
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

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as ChargeBody | null
  if (!body || (body.type !== 'student' && body.type !== 'donor') || !body.id || !(body.amount > 0) || !body.purpose) {
    return NextResponse.json({ error: 'type, id, amount, and purpose are required.' }, { status: 400 })
  }
  if (!body.paymentMethodId && !body.newPaymentMethod) {
    return NextResponse.json({ error: 'paymentMethodId or newPaymentMethod is required.' }, { status: 400 })
  }

  const customer = await resolveSolaCustomer(supabase, body.type, body.id)
  if (!customer.ok) return NextResponse.json({ error: customer.error }, { status: 404 })

  const method = await resolvePaymentMethod(supabase, {
    type: body.type,
    id: body.id,
    solaCustomerId: customer.solaCustomerId,
    paymentMethodId: body.paymentMethodId,
    newPaymentMethod: body.newPaymentMethod,
    save: body.save,
  })
  if (!method.ok) return NextResponse.json({ error: method.error }, { status: 502 })

  const testMode = await isTestMode()
  const result = await processTransaction({ paymentMethodId: method.solaPaymentMethodId, amount: body.amount, description: body.purpose })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

  await supabase.from('payment_transactions').insert([{
    student_id: body.type === 'student' ? body.id : null,
    donor_id: body.type === 'donor' ? body.id : null,
    payment_method_id: method.localPaymentMethodId,
    sola_ref_num: result.approved ? result.refNum : null,
    amount: body.amount,
    purpose: body.purpose,
    status: result.approved ? 'approved' : 'declined',
    is_test: testMode,
    error_message: result.approved ? null : result.error,
    raw_response: result.raw,
  }])

  if (!result.approved) {
    return NextResponse.json({ approved: false, error: result.error, isTest: testMode })
  }

  const refNote = `Sola charge — ref ${result.refNum}${testMode ? ' [TEST MODE]' : ''}`

  if (body.type === 'student' && (body.purpose === 'tuition' || body.purpose === 'building_fund')) {
    const plan = await findLatestPlan(supabase, body.id)
    if (!plan) {
      return NextResponse.json({
        approved: true, refNum: result.refNum, isTest: testMode,
        warning: 'Charge succeeded, but this student has no tuition plan to attach it to — record it manually.',
      })
    }
    await supabase.from('tuition_payments').insert([{
      tuition_plan_id: plan.id,
      student_id: body.id,
      amount: body.amount,
      payment_date: new Date().toISOString().slice(0, 10),
      status: 'paid',
      payment_method: methodLabel(method.methodType),
      payment_type: body.purpose,
      notes: refNote,
    }])
  } else if (body.type === 'student' && body.purpose === 'registration_fee') {
    await supabase.from('students').update({
      registration_fee_status: 'paid',
      registration_fee_paid_date: new Date().toISOString().slice(0, 10),
    }).eq('id', body.id)
  } else if (body.type === 'donor') {
    await supabase.from('donations').insert([{
      donor_id: body.id,
      amount: body.amount,
      donation_method: methodLabel(method.methodType),
      donation_date: new Date().toISOString().slice(0, 10),
      purpose: 'General',
      notes: refNote,
    }])
  }

  return NextResponse.json({ approved: true, refNum: result.refNum, isTest: testMode })
}
