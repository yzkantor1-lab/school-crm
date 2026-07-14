import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import BlockEditor from './BlockEditor'

export default async function EditPageRoute({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params
  const supabase = await createClient()

  const [{ data: page }, { data: blocks }] = await Promise.all([
    supabase.from('site_pages').select('*').eq('id', pageId).single(),
    supabase.from('site_blocks').select('*').eq('page_id', pageId).order('order_index'),
  ])

  if (!page) notFound()

  return <BlockEditor page={page} initialBlocks={blocks ?? []} />
}
