import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCustomerDetail } from '@/lib/sola/client'

type Body = {
  syncCustomerId: string
  action: 'link' | 'confirm' | 'dismiss' | 'reset' | 'create_new'
  donorId?: string
}

// Donor-side counterpart to /api/sola/sync/customer — independent of that
// route's student match on the same sola_sync_customers row, since one Sola
// customer can be both a tuition payer and a donor at once.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body?.syncCustomerId || !body.action) {
    return NextResponse.json({ error: 'syncCustomerId and action are required.' }, { status: 400 })
  }

  const { data: syncCustomer } = await supabase.from('sola_sync_customers').select('*').eq('id', body.syncCustomerId).single()
  if (!syncCustomer) return NextResponse.json({ error: 'Sola sync customer not found.' }, { status: 404 })

  // Ensures a donor<->student link exists whenever a match resolves and a
  // parent-of-student suggestion is attached to this row — covers both the
  // "create new contact" and "confirm an existing donor" paths uniformly.
  async function linkSuggestedStudent(donorId: string) {
    if (!syncCustomer.suggested_donor_student_id) return
    await supabase.from('donor_students')
      .upsert([{ donor_id: donorId, student_id: syncCustomer.suggested_donor_student_id }], { onConflict: 'donor_id,student_id' })
  }

  if (body.action === 'link') {
    if (!body.donorId) return NextResponse.json({ error: 'donorId is required to link.' }, { status: 400 })
    const { error } = await supabase.from('sola_sync_customers')
      .update({ donor_match_status: 'needs_review', matched_donor_id: body.donorId, donor_match_method: 'manual' })
      .eq('id', body.syncCustomerId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'confirm') {
    if (!syncCustomer.matched_donor_id) return NextResponse.json({ error: 'No donor linked to confirm yet.' }, { status: 400 })
    await linkSuggestedStudent(syncCustomer.matched_donor_id)
    const { error } = await supabase.from('sola_sync_customers').update({ donor_match_status: 'matched' }).eq('id', body.syncCustomerId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'dismiss') {
    const { error } = await supabase.from('sola_sync_customers')
      .update({ donor_match_status: 'not_a_donor', matched_donor_id: null, donor_match_method: null, suggested_donor_student_id: null })
      .eq('id', body.syncCustomerId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'reset') {
    const { error } = await supabase.from('sola_sync_customers')
      .update({ donor_match_status: 'unmatched', matched_donor_id: null, donor_match_method: null, suggested_donor_student_id: null })
      .eq('id', body.syncCustomerId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'create_new') {
    // GetCustomer, not the ListCustomers data already on the row — address
    // fields only ever show up on the detail fetch.
    const detail = await getCustomerDetail(syncCustomer.sola_customer_id).catch(() => null)
    const name = [detail?.billFirstName ?? syncCustomer.bill_first_name, detail?.billLastName ?? syncCustomer.bill_last_name]
      .filter(Boolean).join(' ').trim() || 'Unknown Donor'
    const address = [detail?.billStreet, detail?.billCity, [detail?.billState, detail?.billZip].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ') || null

    const { data: newDonor, error: insertError } = await supabase.from('donors').insert([{
      name,
      email: detail?.email ?? syncCustomer.email ?? null,
      phone_number: null, // Sola exposes no phone field at any endpoint
      address,
      category: 'General',
      relationship: syncCustomer.suggested_donor_student_id ? 'Parent' : 'Other',
      sola_customer_id: syncCustomer.sola_customer_id,
    }]).select('id').single()
    if (insertError || !newDonor) return NextResponse.json({ error: insertError?.message ?? 'Failed to create donor.' }, { status: 500 })

    await linkSuggestedStudent(newDonor.id)
    const { error } = await supabase.from('sola_sync_customers')
      .update({ matched_donor_id: newDonor.id, donor_match_status: 'matched', donor_match_method: syncCustomer.donor_match_method ?? 'manual' })
      .eq('id', body.syncCustomerId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, donorId: newDonor.id })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
