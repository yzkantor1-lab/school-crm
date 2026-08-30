import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runSolaSync } from '@/lib/sola/sync'

export const maxDuration = 60

// Runs the same Sola Sync pull as the manual "Run Sync" button (see
// app/api/sola/sync/run/route.ts) automatically every 20 minutes (see the
// schedule in vercel.json). Nothing is ever auto-imported into
// tuition_payments/donations here — this only stages new customers/
// schedules/payments for review, exactly like a manual run. No logged-in
// user exists for a cron invocation, so this uses the service-role admin
// client instead of the cookie-based one, and authenticates the request via
// CRON_SECRET instead of a session — Vercel Cron sends
// "Authorization: Bearer $CRON_SECRET" automatically when that env var is
// set (see vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runSolaSync(createAdminClient())
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to sync with Sola' }, { status: 502 })
  }
}
