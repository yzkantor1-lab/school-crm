import Link from 'next/link'
import { Clock } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

// Compact version of IncomingSolaPayments for a list row — count + total
// only, links straight to Sola Sync since there's no room to list each one.
export default function IncomingSolaBadge({ count, total }: { count: number; total: number }) {
  if (!count) return null
  return (
    <Link
      href="/admin/sola-sync"
      onClick={e => e.stopPropagation()}
      title={`${count} Sola payment${count === 1 ? '' : 's'} (${formatCurrency(total)}) received but not yet categorized`}
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 hover:bg-amber-200 text-xs rounded-full font-medium transition-colors"
    >
      <Clock size={11} /> {count} pending
    </Link>
  )
}
