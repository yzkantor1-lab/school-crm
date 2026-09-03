// Archives a sent/printed statement or receipt PDF into the student's or
// donor's own Documents section (tuition_documents / donor_documents),
// separate from the Communications/Sent-Letters log that already records
// every send — that log is a chronological history; Documents is where
// staff actually look to pull up "the thing we sent this family," notes
// and all, without digging through Communications. Best-effort: a failure
// here must never surface as a send/print failure, the same way the
// existing Communications logging already treats itself as best-effort.

import type { createClient } from '@/lib/supabase/client'

type SupabaseLike = ReturnType<typeof createClient>

function base64ToBlob(base64: string, contentType: string): Blob {
  const byteChars = atob(base64)
  const byteNumbers = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
  return new Blob([new Uint8Array(byteNumbers)], { type: contentType })
}

function storagePath(ownerId: string, fileName: string): string {
  return `${ownerId}/${crypto.randomUUID()}-${fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`
}

export async function archiveTuitionDocument(supabase: SupabaseLike, opts: {
  studentId: string
  fileName: string
  base64: string
  academicYear?: string | null
  tuitionPlanId?: string
  notes?: string
}): Promise<void> {
  try {
    const path = storagePath(opts.studentId, opts.fileName)
    const blob = base64ToBlob(opts.base64, 'application/pdf')
    const { error: uploadError } = await supabase.storage.from('tuition-documents').upload(path, blob, { contentType: 'application/pdf' })
    if (uploadError) { console.warn('Failed to archive tuition document:', uploadError.message); return }
    const { data: doc, error: insertError } = await supabase.from('tuition_documents').insert([{
      student_id: opts.studentId, file_name: opts.fileName, file_path: path,
      file_size: blob.size, content_type: 'application/pdf', academic_year: opts.academicYear ?? null, notes: opts.notes ?? null,
    }]).select('id').single()
    if (insertError) { console.warn('Failed to archive tuition document:', insertError.message); return }
    if (doc && opts.tuitionPlanId) {
      await supabase.from('tuition_document_plans').insert([{ document_id: doc.id, tuition_plan_id: opts.tuitionPlanId }])
    }
  } catch (err) {
    console.warn('Failed to archive tuition document:', err)
  }
}

export async function archiveDonorDocument(supabase: SupabaseLike, opts: {
  donorId: string
  fileName: string
  base64: string
  notes?: string
}): Promise<void> {
  try {
    const path = storagePath(opts.donorId, opts.fileName)
    const blob = base64ToBlob(opts.base64, 'application/pdf')
    const { error: uploadError } = await supabase.storage.from('donor-documents').upload(path, blob, { contentType: 'application/pdf' })
    if (uploadError) { console.warn('Failed to archive donor document:', uploadError.message); return }
    const { error: insertError } = await supabase.from('donor_documents').insert([{
      donor_id: opts.donorId, file_name: opts.fileName, file_path: path,
      file_size: blob.size, content_type: 'application/pdf', notes: opts.notes ?? null,
    }])
    if (insertError) console.warn('Failed to archive donor document:', insertError.message)
  } catch (err) {
    console.warn('Failed to archive donor document:', err)
  }
}
