import type { SupabaseClient } from '@supabase/supabase-js'

// pledges.amount_paid / fulfilled have no database trigger behind them, so
// every code path that adds, edits, or removes a pledge payment (or changes
// a pledge's amount) must call this to keep them derived from the pledge's
// actual payments. Used by both the Pledges page and the in-CRM assistant.
export async function recomputePledgeTotals(db: SupabaseClient, pledgeId: string) {
  const { data: pledge } = await db.from('pledges').select('amount,fulfilled_date').eq('id', pledgeId).maybeSingle()
  if (!pledge) return
  const { data: payments } = await db.from('pledge_payments').select('amount').eq('pledge_id', pledgeId)
  const paid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
  const fulfilled = paid + 0.005 >= Number(pledge.amount)
  await db.from('pledges').update({
    amount_paid: paid, fulfilled,
    fulfilled_date: fulfilled ? (pledge.fulfilled_date ?? new Date().toISOString().slice(0, 10)) : null,
    updated_at: new Date().toISOString(),
  }).eq('id', pledgeId)
}
