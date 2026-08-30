import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runSolaSync } from '@/lib/sola/sync'

export const maxDuration = 60

// Manual trigger for the same sync the cron job runs unattended every 20
// minutes (see app/api/cron/sola-sync/route.ts) — lets staff pull the latest
// on demand (e.g. right after a family reports a payment) instead of waiting
// for the next scheduled run. Both paths share runSolaSync so there's only
// one place the actual sync logic lives.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const result = await runSolaSync(supabase)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to sync with Sola' }, { status: 502 })
  }
}
