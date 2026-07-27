import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCustomer } from '@/lib/sola/client'

// Creates (or returns the existing) Sola customer profile for a student or
// donor. Called right after a student/donor is created in the CRM, from
// StudentEditForm.tsx, tuition/page.tsx's handleAddStudent, and
// donors/page.tsx's addDonor. Always hits the real Sola account — customer
// creation doesn't move money, so it isn't gated by test mode.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const type = body?.type
  const id = body?.id
  if ((type !== 'student' && type !== 'donor') || typeof id !== 'string') {
    return NextResponse.json({ error: 'type ("student" or "donor") and id are required.' }, { status: 400 })
  }

  const table = type === 'student' ? 'students' : 'donors'
  const { data: row, error: fetchError } = await supabase.from(table).select('*').eq('id', id).single()
  if (fetchError || !row) return NextResponse.json({ error: fetchError?.message || 'Record not found' }, { status: 404 })

  if (row.sola_customer_id) return NextResponse.json({ solaCustomerId: row.sola_customer_id, created: false })

  const customerInput = type === 'student'
    ? {
        customerNumber: row.id,
        email: row.father_email || row.mother_email || undefined,
        billFirstName: row.first_name || undefined,
        billLastName: row.last_name || undefined,
      }
    : {
        customerNumber: row.id,
        email: row.email || undefined,
        billFirstName: (row.name || '').split(' ')[0] || undefined,
        billLastName: (row.name || '').split(' ').slice(1).join(' ') || undefined,
        billCompany: row.name || undefined,
      }

  const result = await createCustomer(customerInput)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

  const { error: updateError } = await supabase.from(table).update({ sola_customer_id: result.customerId }).eq('id', id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ solaCustomerId: result.customerId, created: true })
}
