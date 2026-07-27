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
}

// Shared by app/api/send-email/route.ts (staff-initiated, uses the cookie
// session client) and the Sola webhook receiver (no logged-in user at all,
// so it must pass the service-role admin client instead) — both just need
// the connected Google account's credentials out of site_settings.
export async function sendMailViaGoogle(supabase: AnySupabaseClient, input: MailInput) {
  const { data } = await supabase
    .from('site_settings')
    .select('key,value')
    .in('key', ['google_client_id', 'google_client_secret', 'google_refresh_token', 'google_from_email'])

  const cfg = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]))
  if (!cfg.google_refresh_token) throw new Error('Google account not connected. Go to Settings → Email to connect.')

  const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const oauth2Client = new google.auth.OAuth2(cfg.google_client_id, cfg.google_client_secret, `${base}/api/auth/google/callback`)
  oauth2Client.setCredentials({ refresh_token: cfg.google_refresh_token })

  const { token: accessToken } = await oauth2Client.getAccessToken()
  if (!accessToken) throw new Error('Could not refresh Google access token.')

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: cfg.google_from_email,
      clientId: cfg.google_client_id,
      clientSecret: cfg.google_client_secret,
      refreshToken: cfg.google_refresh_token,
      accessToken,
    },
  })

  await transporter.sendMail({
    from: cfg.google_from_email,
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

  return { sent: input.to.length, fromEmail: cfg.google_from_email as string }
}
