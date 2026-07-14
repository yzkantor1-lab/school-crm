import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, ExternalLink, Pencil, Globe, FileText } from 'lucide-react'
import WebsiteSettingsForm from './WebsiteSettingsForm'

export default async function WebsitePage() {
  const supabase = await createClient()
  const [{ data: pages }, { data: settings }] = await Promise.all([
    supabase.from('site_pages').select('*').order('nav_order').order('created_at'),
    supabase.from('site_settings').select('key, value'),
  ])

  const settingsMap: Record<string, string> = {}
  settings?.forEach(s => { settingsMap[s.key] = s.value })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Website</h1>
        <div className="flex gap-3">
          <a href="/" target="_blank" rel="noreferrer"
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition">
            <ExternalLink size={15} /> Preview Site
          </a>
          <Link href="/admin/website/new"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
            <Plus size={16} /> New Page
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <h2 className="font-semibold text-slate-700 text-sm uppercase tracking-wide">Pages</h2>
          {pages?.map(page => (
            <div key={page.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-lg ${page.is_homepage ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-500'}`}>
                  {page.is_homepage ? <Globe size={16} /> : <FileText size={16} />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{page.title}</p>
                    {page.is_homepage && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Home</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      page.published ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {page.published ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {page.is_homepage ? '/' : `/${page.slug}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a href={page.is_homepage ? '/' : `/${page.slug}`} target="_blank" rel="noreferrer"
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
                  <ExternalLink size={15} />
                </a>
                <Link href={`/admin/website/${page.id}/edit`}
                  className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition">
                  <Pencil size={14} /> Edit
                </Link>
              </div>
            </div>
          ))}
          {!pages?.length && (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-10 text-center text-slate-400">
              No pages yet. Create your first page.
            </div>
          )}
        </div>

        <div>
          <h2 className="font-semibold text-slate-700 text-sm uppercase tracking-wide mb-4">Site Settings</h2>
          <WebsiteSettingsForm settings={settingsMap} />
        </div>
      </div>
    </div>
  )
}
