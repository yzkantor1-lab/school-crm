import { createClient } from '@/lib/supabase/server'
import BlockRenderer from '@/components/website/BlockRenderer'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createClient()
  const { data: page } = await supabase
    .from('site_pages')
    .select('title, meta_description')
    .eq('slug', slug)
    .eq('published', true)
    .single()
  if (!page) return {}
  return { title: page.title, description: page.meta_description || undefined }
}

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: page } = await supabase
    .from('site_pages')
    .select('id, title')
    .eq('slug', slug)
    .eq('published', true)
    .single()

  if (!page) notFound()

  const { data: blocks } = await supabase
    .from('site_blocks')
    .select('id, type, content')
    .eq('page_id', page.id)
    .order('order_index')

  return <BlockRenderer blocks={blocks ?? []} />
}
