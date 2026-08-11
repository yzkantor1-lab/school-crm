import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { google } from 'googleapis'

export async function GET() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('site_settings')
    .select('key,value')
    .in('key', ['google_client_id', 'google_client_secret'])

  const map = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const clientId = map.google_client_id
  const clientSecret = map.google_client_secret

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL('/admin/settings?tab=email&error=missing_credentials', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
    )
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/auth/google/callback`

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    // lib/email.ts sends mail via nodemailer's Gmail SMTP OAuth2 transport
    // (XOAUTH2 over smtp.gmail.com), not the Gmail API directly — that SMTP
    // auth mechanism requires the full mail.google.com scope; the narrower
    // gmail.send API scope is valid for Gmail API calls but gets rejected by
    // Gmail's SMTP server with "535-5.7.8 Username and Password not
    // accepted" even though nodemailer is correctly attempting OAuth2.
    scope: ['https://mail.google.com/', 'https://www.googleapis.com/auth/userinfo.email'],
  })

  return NextResponse.redirect(url)
}
