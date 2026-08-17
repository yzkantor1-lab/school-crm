import type { SupabaseClient } from '@supabase/supabase-js'
import { listAllPaymentMethods } from '@/lib/sola/client'
import type { Notification, NotificationSeverity } from './types'

type AnySupabaseClient = Pick<SupabaseClient, 'from'>

type PaymentMethodRow = {
  id: string
  sola_payment_method_id: string
  label: string | null
  student_id: string | null
  donor_id: string | null
  students: { first_name: string; last_name: string; status: string } | null
  donors: { name: string } | null
}

// MMYY -> the last calendar day the card is valid through. Passing the
// 1-indexed real month with day 0 rolls back to the last day of that month
// (JS Date's month param is 0-indexed, so the real month number always
// lands one month ahead of where it's written).
function expMMYYToDate(exp: string): Date | null {
  if (!/^\d{4}$/.test(exp)) return null
  const month = parseInt(exp.slice(0, 2), 10)
  const year = 2000 + parseInt(exp.slice(2, 4), 10)
  if (month < 1 || month > 12) return null
  return new Date(year, month, 0)
}

function daysUntil(date: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((date.getTime() - today.getTime()) / 86400000)
}

// Grows more urgent the closer the card gets to its printed expiration.
// Re-derived from Sola's live data on every load — there's nothing to
// "acknowledge" or reset: as soon as staff saves a replacement card (a new
// payment_methods row with a fresh Exp), the expiring one's notification
// simply stops being generated.
function severityFor(days: number): NotificationSeverity | null {
  if (days < 0) return 'critical'
  if (days <= 14) return 'high'
  if (days <= 30) return 'medium'
  if (days <= 60) return 'low'
  return null
}

export async function getCardExpirationNotifications(supabase: AnySupabaseClient): Promise<Notification[]> {
  const [{ data: methods }, { data: donorSchedules }] = await Promise.all([
    supabase
      .from('payment_methods')
      .select('id,sola_payment_method_id,label,student_id,donor_id,students(first_name,last_name,status),donors(name)')
      .eq('method_type', 'card'),
    // Donor cards only matter here if they're actually being billed on a
    // recurring schedule — a donor's saved-but-unused card isn't in scope.
    supabase
      .from('payment_schedules')
      .select('payment_method_id')
      .eq('status', 'active')
      .eq('purpose', 'donation')
      .not('payment_method_id', 'is', null),
  ])
  if (!methods || !methods.length) return []

  const donorScheduledMethodIds = new Set((donorSchedules ?? []).map(s => s.payment_method_id as string))
  const scoped = (methods as unknown as PaymentMethodRow[]).filter(m => {
    if (m.student_id) return m.students?.status === 'active'
    if (m.donor_id) return donorScheduledMethodIds.has(m.id)
    return false
  })
  if (!scoped.length) return []

  let live: Awaited<ReturnType<typeof listAllPaymentMethods>>
  try {
    live = await listAllPaymentMethods()
  } catch {
    // Sola unreachable — nothing to report rather than a hard page failure.
    return []
  }
  const expByMethodId = new Map(live.map(p => [p.paymentMethodId, p.exp]))

  const notifications: Notification[] = []
  for (const m of scoped) {
    const exp = expByMethodId.get(m.sola_payment_method_id)
    if (!exp) continue
    const expDate = expMMYYToDate(exp)
    if (!expDate) continue
    const days = daysUntil(expDate)
    const severity = severityFor(days)
    if (!severity) continue

    const ownerName = m.student_id
      ? `${m.students?.first_name ?? ''} ${m.students?.last_name ?? ''}`.trim() || 'Unknown student'
      : m.donors?.name ?? 'Unknown donor'
    const link = m.student_id ? `/admin/tuition/${m.student_id}` : `/admin/donors/${m.donor_id}`
    const mmSlash = `${exp.slice(0, 2)}/${exp.slice(2, 4)}`

    notifications.push({
      id: `card-exp:${m.id}`,
      type: 'card_expiration',
      severity,
      title: days < 0 ? `${ownerName}'s card has expired` : `${ownerName}'s card expires ${mmSlash}`,
      description: days < 0
        ? `Card on file (${m.label || 'saved card'}, exp ${mmSlash}) expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago — charges will fail until it's replaced.`
        : `Card on file (${m.label || 'saved card'}) expires in ${days} day${days === 1 ? '' : 's'} — update it before then to avoid a declined charge.`,
      link,
      date: expDate.toISOString().slice(0, 10),
    })
  }

  return notifications
}
