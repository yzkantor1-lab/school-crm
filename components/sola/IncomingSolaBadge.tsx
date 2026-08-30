import { Clock } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

// Compact version of IncomingSolaPayments for a list row — count + total
// only. No link of its own: it sits inside a row that already navigates to
// the family's own page on click, which now has full inline review — no
// need to route anywhere else.
export default function IncomingSolaBadge({ count, total }: { count: number; total: number }) {
  if (!count) return null
  return (
    <span
      title={`${count} Sola payment${count === 1 ? '' : 's'} (${formatCurrency(total)}) received but not yet categorized`}
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium"
    >
      <Clock size={11} /> {count} pending
    </span>
  )
}
