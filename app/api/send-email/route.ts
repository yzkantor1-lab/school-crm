import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendMailViaGoogle } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    const { to, subject, body, isHtml = false, attachments, accountId } = await req.json() as {
      to: string[]
      subject: string
      body: string
      isHtml?: boolean
      attachments?: { filename: string; content: string; contentType?: string }[]
      accountId?: string
    }

    if (!to?.length || !subject || !body) {
      return NextResponse.json({ error: 'Missing required fields: to, subject, body' }, { status: 400 })
    }

    const supabase = await createClient()
    const { sent, fromEmail, accountId: usedAccountId } = await sendMailViaGoogle(supabase, { to, subject, body, isHtml, attachments, accountId })

    return NextResponse.json({ ok: true, sent, fromEmail, accountId: usedAccountId })
  } catch (err) {
    console.error('send-email error', err)
    const message = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
