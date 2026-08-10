'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  GraduationCap, LayoutDashboard, Users, UserRound, UserCog,
  BookOpen, BookMarked, UtensilsCrossed, Receipt, Wallet,
  MessageSquare, CalendarDays, LogOut, Globe, Heart, DollarSign,
  HandHeart, Repeat, TrendingDown, BarChart, BadgeDollarSign, Settings, Award, RefreshCw, PartyPopper,
  ArrowLeftRight, Menu, X
} from 'lucide-react'

const nav = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Students', href: '/admin/students', icon: Users },
  { label: 'Alumni', href: '/admin/alumni', icon: Award },
  { label: 'Guardians', href: '/admin/guardians', icon: UserRound },
  { label: 'Staff', href: '/admin/staff', icon: UserCog },
  { label: 'Classes', href: '/admin/classes', icon: BookOpen },
  { label: 'Terms', href: '/admin/terms', icon: CalendarDays },
  { label: 'Lunch', href: '/admin/lunch', icon: UtensilsCrossed },
  { label: 'Library', href: '/admin/books', icon: BookMarked },
  { label: 'Tuition', href: '/admin/tuition', icon: BadgeDollarSign },
  { label: 'Sola Sync', href: '/admin/sola-sync', icon: RefreshCw },
  { label: 'Billing', href: '/admin/billing', icon: Receipt },
  { label: 'Accounting', href: '/admin/accounting', icon: Wallet },
  { label: 'Communications', href: '/admin/communications', icon: MessageSquare },
  { label: 'Website', href: '/admin/website', icon: Globe },
  { label: '— Fundraising —', href: '', icon: Heart, divider: true },
  { label: 'Donors', href: '/admin/donors', icon: Heart },
  { label: 'Donations', href: '/admin/donations', icon: DollarSign },
  { label: 'Pledges', href: '/admin/pledges', icon: HandHeart },
  { label: 'Recurring', href: '/admin/recurring', icon: Repeat },
  { label: 'Events', href: '/admin/events', icon: PartyPopper },
  { label: 'Expenses', href: '/admin/expenses', icon: TrendingDown },
  { label: 'Cash Flow', href: '/admin/cash-flow', icon: ArrowLeftRight },
  { label: 'Reports', href: '/admin/reports', icon: BarChart },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)

  // Close the mobile drawer on every navigation — otherwise it stays open
  // over the new page after tapping a link.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing open state to the current route, standard pattern for nav drawers
  useEffect(() => { setOpen(false) }, [pathname])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Mobile top bar — the sidebar itself is off-screen by default below
          the md breakpoint, so this is the only way to reach it on a phone. */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-slate-900 text-white h-14 flex items-center justify-between px-4">
        <button onClick={() => setOpen(true)} className="p-1 text-slate-300 hover:text-white" aria-label="Open menu">
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 rounded-lg p-1">
            <GraduationCap size={16} />
          </div>
          <span className="font-bold text-sm">School CRM</span>
        </div>
        <div className="w-8" />
      </div>

      {/* Backdrop — mobile only, closes the drawer on tap outside it. */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)} />
      )}

      <aside className={`w-64 md:w-60 bg-slate-900 text-white flex flex-col h-screen fixed left-0 top-0 z-50 transition-transform duration-200 ease-in-out ${
        open ? 'translate-x-0' : '-translate-x-full'
      } md:translate-x-0`}>
        <div className="flex items-center justify-between gap-3 px-5 py-5 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 rounded-lg p-1.5">
              <GraduationCap size={20} />
            </div>
            <span className="font-bold text-lg">School CRM</span>
          </div>
          <button onClick={() => setOpen(false)} className="md:hidden text-slate-400 hover:text-white" aria-label="Close menu">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {nav.map(({ label, href, icon: Icon, divider }) => {
            if (divider) {
              return (
                <div key={label} className="px-3 pt-4 pb-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Fundraising</p>
                </div>
              )
            }
            const active = pathname === href || (href !== '/admin' && href !== '' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon size={17} />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-slate-700 space-y-0.5">
          {(() => {
            const active = pathname === '/admin/settings' || pathname.startsWith('/admin/settings/')
            return (
              <Link
                href="/admin/settings"
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                  active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Settings size={17} />
                Settings
              </Link>
            )
          })()}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white w-full transition"
          >
            <LogOut size={17} />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  )
}
