import { google } from 'googleapis'
import nodemailer from 'nodemailer'
import type { SupabaseClient } from '@supabase/supabase-js'

type AnySupabaseClient = Pick<SupabaseClient, 'from'>

export type MailInput = {
  to: string[]
  subject: string
  body: string
  isHtml?: boolean
  attachments?: { filename: string; content: string; contentType?: string }[]
  // Which email_accounts row to send from — omitted uses whichever account
  // is marked is_default. Lets a specific send (e.g. a particular letter)
  // override the global default without changing it.
  accountId?: string
}

type EmailAccount = {
  id: string
  email: string
  method: 'oauth' | 'app_password'
  oauth_refresh_token: string | null
  app_password: string | null
}

// Shared by app/api/send-email/route.ts (staff-initiated, uses the cookie
// session client) and the Sola webhook receiver (no logged-in user at all,
// so it must pass the service-role admin client instead).
export async function sendMailViaGoogle(supabase: AnySupabaseClient, input: MailInput) {
  const accountQuery = supabase.from('email_accounts').select('id,email,method,oauth_refresh_token,app_password')
  const { data: account, error: accountError } = input.accountId
    ? await accountQuery.eq('id', input.accountId).single()
    : await accountQuery.eq('is_default', true).maybeSingle()

  if (!account) {
    throw new Error(
      input.accountId
        ? `Could not look up that email account${accountError ? `: ${accountError.message}` : ' (no longer connected)'}`
        : `No connected email account${accountError ? `: ${accountError.message}` : ''}. Go to Settings → Email to connect one and set a default.`
    )
  }
  const acct = account as EmailAccount

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: acct.method === 'oauth'
      ? await oauthTransportAuth(supabase, acct)
      : { user: acct.email, pass: acct.app_password ?? '' },
  })

  await transporter.sendMail({
    from: acct.email,
    to: input.to.join(', '),
    subject: input.subject,
    ...(input.isHtml ? { html: input.body } : { text: input.body }),
    ...(input.attachments?.length ? {
      attachments: input.attachments.map(a => ({
        filename: a.filename,
        content: a.content,
        encoding: 'base64',
        contentType: a.contentType || 'application/pdf',
      })),
    } : {}),
  })

  return { sent: input.to.length, fromEmail: acct.email, accountId: acct.id }
}

// google_client_id/secret are the shared OAuth app registration (one
// Google Cloud project, reused by every OAuth-method account) — still in
// site_settings since they're not per-account. Only oauth_refresh_token
// lives on the email_accounts row itself.
async function oauthTransportAuth(supabase: AnySupabaseClient, acct: EmailAccount) {
  if (!acct.oauth_refresh_token) throw new Error(`${acct.email} is marked OAuth but has no refresh token — reconnect it in Settings → Email.`)

  const { data } = await supabase.from('site_settings').select('key,value').in('key', ['google_client_id', 'google_client_secret'])
  const cfg = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]))
  if (!cfg.google_client_id || !cfg.google_client_secret) throw new Error('Google OAuth app not configured. Go to Settings → Email.')

  const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const oauth2Client = new google.auth.OAuth2(cfg.google_client_id, cfg.google_client_secret, `${base}/api/auth/google/callback`)
  oauth2Client.setCredentials({ refresh_token: acct.oauth_refresh_token })

  const { token: accessToken } = await oauth2Client.getAccessToken()
  if (!accessToken) throw new Error(`Could not refresh Google access token for ${acct.email}.`)

  return {
    type: 'OAuth2' as const,
    user: acct.email,
    clientId: cfg.google_client_id,
    clientSecret: cfg.google_client_secret,
    refreshToken: acct.oauth_refresh_token,
    accessToken,
  }
}
