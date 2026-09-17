import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listAllTransactions, voidOrRefundTransaction } from '@/lib/sola/client'

type Body = { recordType: 'tuition_payment' | 'donation'; recordId: string }

const TABLE = { tuition_payment: 'tuition_payments', donation: 'donations' } as const

// Voids or refunds the real Sola/Cardknox charge behind an already-recorded
// tuition payment or donation — built after the Adler incident (Sept 2026),
// where a schedule cancelled too late to stop its next charge left staff
// with no way to reverse it except calling Cardknox support directly. See
// voidOrRefundTransaction in lib/sola/client.ts for why this hits a
// completely different API than the rest of the Sola integration.
//
// On success, zeroes the local record's amount (rather than deleting it)
// so it stops counting toward any balance/report while still leaving a
// visible, dated audit trail of what happened and why.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body?.recordType || !body.recordId || !(body.recordType in TABLE)) {
    return NextResponse.json({ error: 'recordType and recordId are required.' }, { status: 400 })
  }
  const table = TABLE[body.recordType]

  const { data: record, error: fetchError } = await supabase
    .from(table).select('amount,sola_transaction_id,notes').eq('id', body.recordId).single()
  if (fetchError || !record) return NextResponse.json({ error: 'Record not found.' }, { status: 404 })
  if (!record.sola_transaction_id) return NextResponse.json({ error: "This wasn't a Sola charge — nothing to void or refund." }, { status: 400 })
  if (!(Number(record.amount) > 0)) return NextResponse.json({ error: 'This record has already been voided or refunded.' }, { status: 400 })

  const transactions = await listAllTransactions()
  const match = transactions.find(t => t.transactionId === record.sola_transaction_id)
  if (!match?.gatewayRefNum) return NextResponse.json({ error: "Could not find this charge's gateway reference in Sola — it may be too old to look up." }, { status: 502 })

  const amount = Number(record.amount)
  const result = await voidOrRefundTransaction(match.gatewayRefNum, amount)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

  const today = new Date().toISOString().slice(0, 10)
  const auditLine = result.action === 'voided'
    ? `Voided via Cardknox on ${today} (was $${amount.toFixed(2)}) — no money moved.`
    : `Refunded $${amount.toFixed(2)} via Cardknox on ${today} (ref ${result.refNum}) — returns to their account in a few business days.`

  const { error: updateError } = await supabase.from(table)
    .update({ amount: 0, notes: record.notes ? `${record.notes}\n${auditLine}` : auditLine })
    .eq('id', body.recordId)
  if (updateError) return NextResponse.json({ error: `${result.action === 'voided' ? 'Voided' : 'Refunded'} in Sola, but failed to update the local record: ${updateError.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, action: result.action, amount })
}
