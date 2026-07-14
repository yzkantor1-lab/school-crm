import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { GraduationCap } from 'lucide-react'

async function getSettings() {
  const supabase = await createClient()
  const { data } = await supabase.from('site_settings').select('key, value')
  const map: Record<string, string> = {}
  data?.forEach(r => { map[r.key] = r.value })
  return map
}

async function getNavPages() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('site_pages')
    .select('slug, title, nav_order')
    .eq('published', true)
    .eq('show_in_nav', true)
    .order('nav_order')
  return data ?? []
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [settings, navPages] = await Promise.all([getSettings(), getNavPages()])
  const schoolName = settings.school_name || 'Our School'
  const logoUrl = settings.logo_url

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-supplied URL (unknown host), fluid height via CSS not fixed dimensions
              <img src={logoUrl} alt={schoolName} className="h-9 w-auto object-contain" />
            ) : (
              <div className="bg-blue-700 text-white rounded-lg p-1.5">
                <GraduationCap size={20} />
              </div>
            )}
            <span className="font-bold text-lg text-slate-900">{schoolName}</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <Link href="/" className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition">
              Home
            </Link>
            {navPages.map(page => (
              <Link
                key={page.slug}
                href={`/${page.slug}`}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
              >
                {page.title}
              </Link>
            ))}
          </nav>

          <Link
            href="/login"
            className="text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg transition"
          >
            Staff Login
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="bg-slate-900 text-slate-400 py-10 mt-16">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 text-white rounded-md p-1">
                <GraduationCap size={16} />
              </div>
              <span className="text-white font-semibold">{schoolName}</span>
            </div>
            <div className="text-sm space-y-1 text-center md:text-right">
              {settings.school_address && <p>{settings.school_address}</p>}
              {settings.school_phone && <p>{settings.school_phone}</p>}
              {settings.school_email && (
                <p><a href={`mailto:${settings.school_email}`} className="hover:text-white transition">{settings.school_email}</a></p>
              )}
            </div>
          </div>
          <div className="border-t border-slate-800 mt-8 pt-6 text-xs text-center">
            © {new Date().getFullYear()} {schoolName}. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
