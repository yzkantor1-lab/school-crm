import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { google } from 'googleapis'
import nodemailer from 'nodemailer'

export async function POST(req: NextRequest) {
  try {
    const { to, subject, body, isHtml = false, attachments } = await req.json() as {
      to: string[]
      subject: string
      body: string
      isHtml?: boolean
      attachments?: { filename: string; content: string; contentType?: string }[]
    }

    if (!to?.length || !subject || !body) {
      return NextResponse.json({ error: 'Missing required fields: to, subject, body' }, { status: 400 })
    }

    // Load credentials from site_settings
    const supabase = await createClient()
    const { data } = await supabase
      .from('site_settings')
      .select('key,value')
      .in('key', ['google_client_id', 'google_client_secret', 'google_refresh_token', 'google_from_email'])

    const cfg = Object.fromEntries((data || []).map((r: any) => [r.key, r.value]))

    if (!cfg.google_refresh_token) {
      return NextResponse.json({ error: 'Google account not connected. Go to Settings → Email to connect.' }, { status: 400 })
    }

    const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const oauth2Client = new google.auth.OAuth2(
      cfg.google_client_id,
      cfg.google_client_secret,
      `${BASE}/api/auth/google/callback`
    )
    oauth2Client.setCredentials({ refresh_token: cfg.google_refresh_token })

    const { token: accessToken } = await oauth2Client.getAccessToken()
    if (!accessToken) {
      return NextResponse.json({ error: 'Could not refresh Google access token.' }, { status: 500 })
    }

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
    } as any)

    await transporter.sendMail({
      from: cfg.google_from_email,
      to: to.join(', '),
      subject,
      ...(isHtml ? { html: body } : { text: body }),
      ...(attachments?.length ? {
        attachments: attachments.map(a => ({
          filename: a.filename,
          content: a.content,
          encoding: 'base64',
          contentType: a.contentType || 'application/pdf',
        })),
      } : {}),
    })

    return NextResponse.json({ ok: true, sent: to.length })
  } catch (err: any) {
    console.error('send-email error', err)
    return NextResponse.json({ error: err.message || 'Failed to send email' }, { status: 500 })
  }
}
