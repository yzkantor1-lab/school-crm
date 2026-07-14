'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface Block {
  id: string
  type: string
  content: Record<string, any>
  order_index: number
}

export async function savePage(
  pageId: string,
  pageData: { title: string; published: boolean; meta_description: string; show_in_nav: boolean; nav_order: number },
  blocks: Block[]
) {
  const supabase = await createClient()

  await supabase
    .from('site_pages')
    .update({ ...pageData, updated_at: new Date().toISOString() })
    .eq('id', pageId)

  await supabase.from('site_blocks').delete().eq('page_id', pageId)

  if (blocks.length > 0) {
    await supabase.from('site_blocks').insert(
      blocks.map((b, i) => ({
        page_id: pageId,
        type: b.type,
        order_index: i,
        content: b.content,
      }))
    )
  }

  revalidatePath('/')
  revalidatePath(`/[slug]`, 'page')
}

export async function deletePage(pageId: string) {
  const supabase = await createClient()
  await supabase.from('site_pages').delete().eq('id', pageId)
  revalidatePath('/')
}
