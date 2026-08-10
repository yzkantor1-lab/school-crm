import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processTransaction, isTestMode } from '@/lib/sola/client'
import { resolveSolaCustomer, resolvePaymentMethod, type NewPaymentMethodInput } from '@/lib/sola/context'
import { recordApprovedCharge } from '@/lib/sola/ledger'

type ChargeBody = {
  type: 'student' | 'donor'
  id: string
  amount: number
  purpose: 'tuition' | 'building_fund' | 'registration_fee' | 'donation' | 'phone_charge'
  paymentMethodId?: string
  newPaymentMethod?: NewPaymentMethodInput
  save?: boolean
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
    // Exposing Sola's own PaymentMethodId (not raw card/bank data) lets the
    // UI offer "retry in N days" without asking for payment details again —
    // it's just Sola's reference to a method the family already authorized
    // for this attempt.
    return NextResponse.json({ approved: false, error: result.error, isTest: testMode, solaPaymentMethodId: method.solaPaymentMethodId })
  }

  const { warning } = await recordApprovedCharge(supabase, {
    type: body.type,
    id: body.id,
    amount: body.amount,
    purpose: body.purpose,
    methodType: method.methodType,
    refNum: result.refNum,
    isTest: testMode,
  })

  return NextResponse.json({ approved: true, refNum: result.refNum, isTest: testMode, warning })
}
