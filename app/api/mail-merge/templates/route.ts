import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { detectMergeFields } from '@/lib/mailMerge'

const BUCKET = 'mail-merge-templates'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('document_templates').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ templates: data })
}

// Accepts a .docx as multipart/form-data (`file`, `name`), scans it for
// {{Field}} placeholders, and stores both the file and the detected fields
// so the merge-job UI knows what to collect without the field list being
// declared by hand.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const name = form?.get('name')
  if (!(file instanceof File) || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'file and name are required.' }, { status: 400 })
  }
  if (!file.name.toLowerCase().endsWith('.docx')) {
    return NextResponse.json({ error: 'Only .docx templates are supported.' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  let mergeFields: string[]
  try {
    mergeFields = await detectMergeFields(buffer)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to read template.' }, { status: 400 })
  }

  const path = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: template, error: insertError } = await supabase.from('document_templates').insert([{
    name: name.trim(),
    file_path: path,
    merge_fields: mergeFields,
  }]).select().single()
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  return NextResponse.json({ template })
}
