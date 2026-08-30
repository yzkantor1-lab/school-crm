import Link from 'next/link'
import { Clock, HelpCircle } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

export type PendingSolaPayment = {
  id: string
  amount: number | null
  transaction_date: string | null
  charge_kind: 'tuition' | 'donation' | 'ambiguous'
  suggested_fee_type: string | null
  suggested_donation_category: string | null
  import_status: string
}

function kindLabel(p: PendingSolaPayment) {
  if (p.charge_kind === 'ambiguous') return 'not sure yet'
  if (p.charge_kind === 'tuition') {
    if (p.suggested_fee_type === 'building_fund') return 'looks like Building Fund'
    if (p.suggested_fee_type === 'registration_fee') return 'looks like Registration Fee'
    return 'looks like Tuition'
  }
  return 'looks like a Donation'
}

// A Sola charge that's real (approved, actual money moved) but hasn't been
// reviewed/imported into tuition_payments or donations yet — surfaced here so
// staff see it on the family's own record right away instead of only in the
// Sola Sync queue, which nobody may think to check. Read-only: resolving one
// still happens on the Sola Sync page, this just points there.
export default function IncomingSolaPayments({ payments }: { payments: PendingSolaPayment[] }) {
  if (!payments.length) return null
  const total = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0)

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
          <Clock size={16} />
          Incoming from Sola — not yet categorized ({payments.length}, {formatCurrency(total)})
        </div>
        <Link href="/admin/sola-sync" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
          Review in Sola Sync
        </Link>
      </div>
      <p className="text-xs text-amber-700 mb-2">
        Sola shows this money as received, but it hasn&apos;t been recorded here yet — it won&apos;t count toward balance until reviewed.
      </p>
      <div className="space-y-1">
        {payments.map(p => (
          <div key={p.id} className="flex items-center justify-between text-xs bg-white/60 rounded-lg px-2.5 py-1.5">
            <span className="text-amber-900">{p.transaction_date ? new Date(p.transaction_date + 'T00:00:00').toLocaleDateString() : 'Unknown date'}</span>
            <span className="text-amber-900 font-medium">{p.amount != null ? formatCurrency(Number(p.amount)) : '—'}</span>
            <span className="flex items-center gap-1 text-amber-600">
              {p.charge_kind === 'ambiguous' && <HelpCircle size={12} />}
              {kindLabel(p)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
