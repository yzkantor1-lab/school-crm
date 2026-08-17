'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, AlertTriangle, CreditCard } from 'lucide-react'

type Severity = 'low' | 'medium' | 'high' | 'critical'

type Notification = {
  id: string
  type: string
  severity: Severity
  title: string
  description: string
  link?: string
  date?: string
}

// New notification types just need an entry here — everything else (page
// layout, grouping, severity styling) is generic.
const TYPE_META: Record<string, { label: string; icon: typeof CreditCard }> = {
  card_expiration: { label: 'Card Expirations', icon: CreditCard },
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Expired', high: 'Urgent', medium: 'Upcoming', low: 'Heads up' }
const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'bg-red-50 border-red-200 text-red-700',
  high: 'bg-orange-50 border-orange-200 text-orange-700',
  medium: 'bg-amber-50 border-amber-200 text-amber-700',
  low: 'bg-slate-100 border-slate-200 text-slate-600',
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/notifications')
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to load notifications.')
        setNotifications(json.notifications || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notifications.')
      }
      setLoading(false)
    }
    load()
  }, [])

  const byType = notifications.reduce<Record<string, Notification[]>>((acc, n) => {
    (acc[n.type] ??= []).push(n)
    return acc
  }, {})

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2.5">
        <Bell size={22} className="text-slate-700" />
        <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : notifications.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center">
          <Bell size={36} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Nothing needs attention right now.</p>
        </div>
      ) : (
        Object.entries(byType).map(([type, items]) => {
          const meta = TYPE_META[type] ?? { label: type, icon: AlertTriangle }
          const Icon = meta.icon
          const sorted = [...items].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
          return (
            <div key={type} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
                <Icon size={16} className="text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-900">{meta.label}</h2>
                <span className="text-xs text-slate-400">({items.length})</span>
              </div>
              <div className="divide-y divide-slate-50">
                {sorted.map(n => (
                  <div key={n.id} className="flex items-start gap-3 px-5 py-3">
                    <span className={`shrink-0 mt-0.5 text-xs font-semibold px-2 py-0.5 rounded-full border ${SEVERITY_STYLE[n.severity]}`}>
                      {SEVERITY_LABEL[n.severity]}
                    </span>
                    <div className="flex-1 min-w-0">
                      {n.link ? (
                        <Link href={n.link} className="text-sm font-medium text-slate-900 hover:text-blue-600">{n.title}</Link>
                      ) : (
                        <p className="text-sm font-medium text-slate-900">{n.title}</p>
                      )}
                      <p className="text-xs text-slate-500 mt-0.5">{n.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
