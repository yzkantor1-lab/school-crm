import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Body = {
  syncCustomerId: string
  action: 'link' | 'confirm' | 'dismiss' | 'reset'
  studentId?: string
}

// Handles the manual side of matching a Sola customer to a CRM student:
// - link: staff picked a student for an unmatched/needs_review row — always
//   lands on 'needs_review' (linking isn't the same as confirming; a human
//   still has to look at the payment history before it counts as matched).
// - confirm: staff reviewed a needs_review row (auto-suggested or manually
//   linked) and confirmed the match.
// - dismiss: this Sola customer isn't a student (e.g. a donor).
// - reset: undo dismiss/confirm back to unmatched, no student attached.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body?.syncCustomerId || !body.action) {
    return NextResponse.json({ error: 'syncCustomerId and action are required.' }, { status: 400 })
  }

  let update: Record<string, unknown>
  switch (body.action) {
    case 'link':
      if (!body.studentId) return NextResponse.json({ error: 'studentId is required to link.' }, { status: 400 })
      update = { match_status: 'needs_review', matched_student_id: body.studentId, match_method: 'manual' }
      break
    case 'confirm': {
      const { data: row } = await supabase.from('sola_sync_customers').select('matched_student_id').eq('id', body.syncCustomerId).single()
      if (!row?.matched_student_id) return NextResponse.json({ error: 'No student linked to confirm yet.' }, { status: 400 })
      update = { match_status: 'matched' }
      break
    }
    case 'dismiss':
      update = { match_status: 'not_a_student', matched_student_id: null, match_method: null }
      break
    case 'reset':
      update = { match_status: 'unmatched', matched_student_id: null, match_method: null }
      break
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  const { error } = await supabase.from('sola_sync_customers').update(update).eq('id', body.syncCustomerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
