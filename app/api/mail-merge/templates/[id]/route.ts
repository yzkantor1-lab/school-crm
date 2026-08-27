import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const BUCKET = 'mail-merge-templates'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: template } = await supabase.from('document_templates').select('file_path').eq('id', id).single()
  if (!template) return NextResponse.json({ error: 'Template not found.' }, { status: 404 })

  // Documents already generated from this template are untouched — only the
  // template itself (and its own file) is removed; merge_documents.template_id
  // just goes null via the migration's on delete set null.
  await supabase.storage.from(BUCKET).remove([template.file_path])
  const { error } = await supabase.from('document_templates').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
