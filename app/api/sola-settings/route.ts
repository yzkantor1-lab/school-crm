import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Sola API key management — the raw value is never returned to the browser
// in any response, including this one. Only a masked summary is exposed.
// All reads/writes of the actual key go through the service-role admin
// client, since payment_settings has no RLS policies for the browser client.

async function requireAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

function mask(value: string) {
  const last4 = value.slice(-4)
  return `•••• ${last4}`
}

export async function GET() {
  if (!(await requireAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const [{ data, error }, { data: testModeRow }] = await Promise.all([
    admin.from('payment_settings').select('key_value,updated_at').eq('provider', 'sola').eq('key_name', 'api_key').maybeSingle(),
    admin.from('payment_settings').select('key_value').eq('provider', 'sola').eq('key_name', 'test_mode').maybeSingle(),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Defaults to test mode (safe-by-default) whenever the row hasn't been set yet.
  const testMode = testModeRow?.key_value !== 'false'

  if (!data) return NextResponse.json({ configured: false, testMode })

  return NextResponse.json({
    configured: true,
    masked: mask(data.key_value),
    updatedAt: data.updated_at,
    testMode,
  })
}

// Toggles test mode only — separate from POST (which replaces the API key)
// so the two controls in the UI can't accidentally clobber each other.
export async function PATCH(req: Request) {
  if (!(await requireAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (typeof body?.testMode !== 'boolean') {
    return NextResponse.json({ error: 'testMode (boolean) is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('payment_settings')
    .upsert(
      { provider: 'sola', key_name: 'test_mode', key_value: String(body.testMode), updated_at: new Date().toISOString() },
      { onConflict: 'provider,key_name' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ testMode: body.testMode })
}

export async function POST(req: Request) {
  if (!(await requireAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (!key) return NextResponse.json({ error: 'A key value is required.' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('payment_settings')
    .upsert(
      { provider: 'sola', key_name: 'api_key', key_value: key, updated_at: new Date().toISOString() },
      { onConflict: 'provider,key_name' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ configured: true, masked: mask(key) })
}

export async function DELETE() {
  if (!(await requireAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('payment_settings')
    .delete()
    .eq('provider', 'sola')
    .eq('key_name', 'api_key')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ configured: false })
}
