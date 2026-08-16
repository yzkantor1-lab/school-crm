import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordApprovedCharge } from '@/lib/sola/ledger'
import { notifyStaffOfPaymentFailure } from '@/lib/sola/notify'

// Receives real-time transaction events from Sola for schedule-driven
// charges (recurring payments / payment plan installments) — these happen
// on Sola's own clock, not a request we make, so this is the only way the
// CRM finds out about them. No auth check: Sola calls this directly, not a
// logged-in staff member — the ck-signature check below is what stands in
// for authentication here.
//
// IMPLEMENTATION NOTE: docs.solapayments.com/products/webhooks documents the
// signature algorithm in prose (URL-decode, lowercase keys, sort
// alphabetically, concatenate values, append the webhook PIN, MD5) but not a
// worked example, and doesn't confirm whether a schedule's Custom01 is
// echoed back verbatim or under a different field name. This has NOT been
// validated against a real Sola-sent webhook (the Postback URL is
// intentionally still blank in the Sola portal per instructions) — verify
// signature verification against the first real test event before relying
// on it, ideally by temporarily logging the raw body/headers.

function verifySignature(rawBody: string, signatureHeader: string, pin: string): boolean {
  const pairs: [string, string][] = []
  for (const pair of rawBody.split('&')) {
    if (!pair) continue
    const idx = pair.indexOf('=')
    const rawKey = idx === -1 ? pair : pair.slice(0, idx)
    const rawValue = idx === -1 ? '' : pair.slice(idx + 1)
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' ')).toLowerCase()
    const value = decodeURIComponent(rawValue.replace(/\+/g, ' '))
    pairs.push([key, value])
  }
  pairs.sort(([a], [b]) => a.localeCompare(b))
  const combined = pairs.map(([, v]) => v).join('') + pin
  const hash = crypto.createHash('md5').update(combined).digest('hex')
  return hash.toLowerCase() === signatureHeader.toLowerCase().trim()
}

function parseFormBody(rawBody: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of rawBody.split('&')) {
    if (!pair) continue
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const key = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '))
    const value = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '))
    result[key] = value
  }
  return result
}

type ScheduleContext = { type: 'student' | 'donor'; id: string; purpose: string }

export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature = req.headers.get('ck-signature')
  const pin = process.env.SOLA_WEBHOOK_PIN

  if (!pin) return NextResponse.json({ error: 'SOLA_WEBHOOK_PIN is not configured' }, { status: 500 })
  if (!signature || !verifySignature(rawBody, signature, pin)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const fields = parseFormBody(rawBody)
  const approved = fields.xResult === 'A' || fields.xResponseResult === 'Approved'
  const refNum = fields.xRefNum || ''
  const amount = parseFloat(fields.xAmount || '0')
  // Field name for echoed custom data isn't confirmed by docs — check both
  // the classic gateway naming (xCustom02) and the v2 REST naming (Custom02).
  // (We send this data in Custom02, not Custom01 — Custom01 is reserved by
  // Sola and CreateSchedule/ProcessTransaction reject it outright.)
  const customRaw = fields.xCustom02 || fields.Custom02 || fields.custom02 || ''
  const methodType: 'card' | 'ach' = fields.xMaskedCardNumber || fields.xCardType ? 'card' : 'ach'

  let context: ScheduleContext | null = null
  try {
    const parsed = JSON.parse(customRaw)
    if (parsed?.type && parsed?.id && parsed?.purpose) context = parsed
  } catch {
    // No correlated context — still record the raw event below, just without CRM linkage.
  }

  const admin = createAdminClient()

  let scheduleId: string | null = null
  let ownerName = 'Unknown'
  if (context) {
    const ownerCol = context.type === 'student' ? 'student_id' : 'donor_id'
    const { data: schedule } = await admin
      .from('payment_schedules')
      .select('id')
      .eq(ownerCol, context.id)
      .eq('purpose', context.purpose)
      .eq('status', 'active')
      .maybeSingle()
    scheduleId = schedule?.id ?? null

    if (context.type === 'student') {
      const { data: student } = await admin.from('students').select('first_name,last_name').eq('id', context.id).maybeSingle()
      if (student) ownerName = [student.first_name, student.last_name].filter(Boolean).join(' ') || 'Unknown'
    } else {
      const { data: donor } = await admin.from('donors').select('name').eq('id', context.id).maybeSingle()
      if (donor) ownerName = donor.name || 'Unknown'
    }
  }

  await admin.from('payment_transactions').insert([{
    student_id: context?.type === 'student' ? context.id : null,
    donor_id: context?.type === 'donor' ? context.id : null,
    schedule_id: scheduleId,
    sola_ref_num: refNum || null,
    amount,
    purpose: context?.purpose || 'unknown',
    status: approved ? 'approved' : 'declined',
    is_test: false, // webhooks only ever fire from real Sola activity
    error_message: approved ? null : (fields.xError || fields.xStatus || 'Declined'),
    raw_response: fields,
  }])

  if (context && approved) {
    await recordApprovedCharge(admin, {
      type: context.type,
      id: context.id,
      amount,
      purpose: context.purpose,
      methodType,
      refNum,
      isTest: false,
    })
  }

  if (context && !approved) {
    await notifyStaffOfPaymentFailure({
      ownerName,
      amount,
      purpose: context.purpose,
      error: fields.xError || fields.xStatus || 'Declined',
      isRetry: false,
    })
  }

  return NextResponse.json({ received: true })
}
