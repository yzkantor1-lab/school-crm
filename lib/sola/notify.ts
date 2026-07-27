import { createAdminClient } from '@/lib/supabase/admin'
import { sendMailViaGoogle } from '@/lib/email'

// Sends "a payment failed" to the connected Gmail account (Settings > Email)
// — reuses the same account transactional receipts/statements go out from,
// since that's the only outbound email path already wired up in this app.
// Best-effort: a notification failure is logged, never thrown, since it
// should never mask the underlying payment failure it's reporting on.
export async function notifyStaffOfPaymentFailure(opts: {
  ownerName: string
  amount: number
  purpose: string
  error: string
  isRetry: boolean
}) {
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('site_settings').select('value').eq('key', 'google_from_email').maybeSingle()
    const to = data?.value
    if (!to) { console.warn('No notification email configured (Settings > Email) — skipping payment failure notification.'); return }

    await sendMailViaGoogle(admin, {
      to: [to],
      subject: `Payment failed — ${opts.ownerName} ($${opts.amount.toFixed(2)} ${opts.purpose})`,
      body: [
        `A Sola payment failed for ${opts.ownerName}.`,
        '',
        `Amount: $${opts.amount.toFixed(2)}`,
        `For: ${opts.purpose}`,
        `Reason: ${opts.error}`,
        '',
        opts.isRetry
          ? 'This was a retry attempt — no further automatic retry is scheduled.'
          : 'A retry will be scheduled automatically if one was configured.',
      ].join('\n'),
    })
  } catch (err) {
    console.warn('Failed to send payment failure notification:', err)
  }
}
