import { createAdminClient } from '@/lib/supabase/admin'
import { sendMailViaGoogle } from '@/lib/email'

// Sends "a payment failed" to the default connected account (Settings >
// Email) — reuses the same account transactional receipts/statements go out
// from, since that's the only outbound email path already wired up in this
// app. Best-effort: a notification failure is logged, never thrown, since it
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
    const { data } = await admin.from('email_accounts').select('email').eq('is_default', true).maybeSingle()
    const to = data?.email
    if (!to) { console.warn('No default connected email account (Settings > Email) — skipping payment failure notification.'); return }

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
