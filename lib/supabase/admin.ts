import { createClient } from '@supabase/supabase-js'

// Service-role client for server-only code paths that must bypass RLS —
// currently just payment_settings, which has no policies at all so the
// anon/authenticated browser client can never read it. Never import this
// into a 'use client' component; it must only run in API routes/server code.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
