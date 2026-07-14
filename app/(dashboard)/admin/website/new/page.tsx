'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function NewWebsitePage() {
  const router = useRouter()
  const supabase = createClient()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleTitleChange(v: string) {
    setTitle(v)
    setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  }

  async function handleCreate() {
    if (!title || !slug) { setError('Title and slug are required.'); return }
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('site_pages')
      .insert({ title, slug, published: false, show_in_nav: true })
      .select('id')
      .single()
    if (err) { setError(err.message); setLoading(false); return }
    router.push(`/admin/website/${data.id}/edit`)
  }

  return (
    <div className="max-w-lg">
      <Link href="/admin/website" className="flex items-center gap-1 text-slate-500 hover:text-slate-700 text-sm mb-5">
        <ArrowLeft size={15} /> Back to Website
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">New Page</h1>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Page Title</label>
          <input
            value={title}
            onChange={e => handleTitleChange(e.target.value)}
            placeholder="e.g. About Us"
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">URL Slug</label>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">yourschool.com/</span>
            <input
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="about-us"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={handleCreate}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create Page'}
          </button>
          <Link href="/admin/website" className="text-sm text-slate-600 hover:text-slate-900 px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition">
            Cancel
          </Link>
        </div>
      </div>
    </div>
  )
}
