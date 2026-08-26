import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { google } from 'googleapis'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${BASE}/admin/settings?tab=email&error=oauth_denied`)
  }

  const supabase = await createClient()
  const { data } = await supabase
    .from('site_settings')
    .select('key,value')
    .in('key', ['google_client_id', 'google_client_secret'])

  const map = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const redirectUri = `${BASE}/api/auth/google/callback`
  const oauth2Client = new google.auth.OAuth2(map.google_client_id, map.google_client_secret, redirectUri)

  try {
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // Get the email address from the token
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()
    if (!userInfo.email) return NextResponse.redirect(`${BASE}/admin/settings?tab=email&error=token_exchange`)
    if (!tokens.refresh_token) return NextResponse.redirect(`${BASE}/admin/settings?tab=email&error=no_refresh_token`)

    // One row per connected account, upserted by email so reconnecting the
    // same address updates its token rather than creating a duplicate. The
    // very first account connected becomes the default automatically;
    // afterward, staff pick the default explicitly in Settings → Email.
    const { count } = await supabase.from('email_accounts').select('id', { count: 'exact', head: true })

    // is_default is deliberately omitted unless this is the very first
    // account ever connected — an upsert that reconnects an EXISTING
    // account (e.g. after an invalid_grant) must never touch its current
    // default status, and omitting the key (rather than passing false)
    // leaves it untouched on the UPDATE path.
    const { error } = await supabase.from('email_accounts').upsert([{
      label: userInfo.email,
      email: userInfo.email,
      method: 'oauth',
      oauth_refresh_token: tokens.refresh_token,
      updated_at: new Date().toISOString(),
      ...(count === 0 ? { is_default: true } : {}),
    }], { onConflict: 'email' })
    if (error) return NextResponse.redirect(`${BASE}/admin/settings?tab=email&error=token_exchange`)

    return NextResponse.redirect(`${BASE}/admin/settings?tab=email&success=connected`)
  } catch {
    return NextResponse.redirect(`${BASE}/admin/settings?tab=email&error=token_exchange`)
  }
}
