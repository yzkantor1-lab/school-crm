import { createClient } from '@/lib/supabase/server'
import BlockRenderer from '@/components/website/BlockRenderer'

export default async function PublicHomePage() {
  const supabase = await createClient()

  const { data: page } = await supabase
    .from('site_pages')
    .select('id, title')
    .eq('is_homepage', true)
    .eq('published', true)
    .single()

  if (!page) {
    return (
      <div className="flex items-center justify-center min-h-96 text-slate-400">
        <p>Website coming soon.</p>
      </div>
    )
  }

  const { data: blocks } = await supabase
    .from('site_blocks')
    .select('id, type, content')
    .eq('page_id', page.id)
    .order('order_index')

  return <BlockRenderer blocks={blocks ?? []} />
}
