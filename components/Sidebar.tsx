'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  GraduationCap, LayoutDashboard, Users, UserRound, UserCog,
  BookOpen, BookMarked, UtensilsCrossed, Receipt, Wallet,
  BookText, MessageSquare, CalendarDays, LogOut
} from 'lucide-react'

const nav = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Students', href: '/students', icon: Users },
  { label: 'Guardians', href: '/guardians', icon: UserRound },
  { label: 'Staff', href: '/staff', icon: UserCog },
  { label: 'Classes', href: '/classes', icon: BookOpen },
  { label: 'Terms', href: '/terms', icon: CalendarDays },
  { label: 'Lunch', href: '/lunch', icon: UtensilsCrossed },
  { label: 'Library', href: '/books', icon: BookMarked },
  { label: 'Billing', href: '/billing', icon: Receipt },
  { label: 'Accounting', href: '/accounting', icon: Wallet },
  { label: 'Library Books', href: '/books', icon: BookText },
  { label: 'Communications', href: '/communications', icon: MessageSquare },
]

const uniqueNav = nav.filter((item, idx, arr) => arr.findIndex(i => i.href === item.href) === idx)

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="w-60 bg-slate-900 text-white flex flex-col h-screen fixed left-0 top-0">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-700">
        <div className="bg-blue-600 rounded-lg p-1.5">
          <GraduationCap size={20} />
        </div>
        <span className="font-bold text-lg">School CRM</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {uniqueNav.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href + label}
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

      <div className="px-3 py-4 border-t border-slate-700">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white w-full transition"
        >
          <LogOut size={17} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
