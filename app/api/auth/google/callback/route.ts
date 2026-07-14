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

    // Persist refresh token + from-email in site_settings
    const upserts = [
      { key: 'google_refresh_token', value: tokens.refresh_token || '' },
      { key: 'google_from_email',    value: userInfo.email || '' },
    ]
    await Promise.all(
      upserts.map(u => supabase.from('site_settings').upsert(u, { onConflict: 'key' }))
    )

    return NextResponse.redirect(`${BASE}/admin/settings?tab=email&success=connected`)
  } catch {
    return NextResponse.redirect(`${BASE}/admin/settings?tab=email&error=token_exchange`)
  }
}
