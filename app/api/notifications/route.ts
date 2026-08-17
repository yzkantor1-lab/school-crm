import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCardExpirationNotifications } from '@/lib/notifications/cardExpirations'

// Aggregates every notification type into one feed. Add a new type by
// writing its own lib/notifications/*.ts generator and appending it to
// this Promise.all — the page groups/styles purely by the `type` and
// `severity` each notification reports, so nothing else needs to change.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [cardExpirations] = await Promise.all([
    getCardExpirationNotifications(supabase),
  ])

  return NextResponse.json({ notifications: [...cardExpirations] })
}
