import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Body = { syncPaymentId: string; resolution: 'same' | 'separate' | 'correction' }

// The human half of the "never silently merge or skip a possible-duplicate
// donation" requirement — a payment only ever reaches here after the import
// route flagged it 'needs_review' with a duplicate_of_donation_id pointer.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body?.syncPaymentId || !body.resolution) {
    return NextResponse.json({ error: 'syncPaymentId and resolution are required.' }, { status: 400 })
  }

  const { data: payment } = await supabase.from('sola_sync_payments').select('*').eq('id', body.syncPaymentId).single()
  if (!payment) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (payment.import_status !== 'needs_review' || !payment.duplicate_of_donation_id) {
    return NextResponse.json({ error: 'This payment has no pending duplicate to resolve.' }, { status: 400 })
  }

  const { data: syncCustomer } = await supabase.from('sola_sync_customers').select('matched_donor_id').eq('id', payment.sola_sync_customer_id).single()
  const donorId: string | null = syncCustomer?.matched_donor_id ?? null

  if (body.resolution === 'same') {
    const { error } = await supabase.from('sola_sync_payments')
      .update({ import_status: 'duplicate', duplicate_resolution: 'same' }).eq('id', payment.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.resolution === 'separate') {
    if (!donorId) return NextResponse.json({ error: 'No confirmed donor to attach this donation to.' }, { status: 400 })
    const { data: inserted, error } = await supabase.from('donations').insert([{
      donor_id: donorId, amount: payment.amount, donation_method: 'Online Payment', donation_date: payment.transaction_date,
      purpose: 'General Fund', category: payment.resolved_category, event_id: payment.resolved_event_id,
      source: 'sola', sola_transaction_id: payment.sola_transaction_id, notes: 'Imported from Sola sync (confirmed separate from a similar-looking donation)',
    }]).select('id').single()
    if (error || !inserted) return NextResponse.json({ error: error?.message ?? 'Insert failed.' }, { status: 500 })
    await supabase.from('sola_sync_payments')
      .update({ import_status: 'imported', duplicate_resolution: 'separate', donation_id: inserted.id }).eq('id', payment.id)
    return NextResponse.json({ ok: true })
  }

  // correction: the existing donation gets Sola's amount/date instead of a new row.
  const { error: updateError } = await supabase.from('donations').update({
    amount: payment.amount, donation_date: payment.transaction_date, sola_transaction_id: payment.sola_transaction_id,
  }).eq('id', payment.duplicate_of_donation_id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  await supabase.from('sola_sync_payments')
    .update({ import_status: 'imported', duplicate_resolution: 'correction', donation_id: payment.duplicate_of_donation_id }).eq('id', payment.id)
  return NextResponse.json({ ok: true })
}
