'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Upload, FileText, Trash2, Link2, Loader2, Eye, Unlink } from 'lucide-react'

type TuitionDocument = {
  id: string
  student_id: string
  file_name: string
  file_path: string
  file_size: number | null
  content_type: string | null
  academic_year: string | null
  notes: string | null
  uploaded_at: string
}

const BUCKET = 'tuition-documents'

function formatFileSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Uploaded tuition contract documents — separate from the generated
// statements/receipts in SentLettersPanel. Used in two modes:
// - Student-level (no tuitionPlanId): every document on file for the
//   student, regardless of which plan(s) it's linked to.
// - Plan-level (tuitionPlanId set): only documents linked to that specific
//   plan, plus "Link Existing" to reuse a document already uploaded
//   elsewhere (e.g. a prior year's contract carried forward) without
//   re-uploading it, alongside "Upload New" for a fresh one scoped here.
export default function TuitionDocumentsPanel({
  studentId, tuitionPlanId, academicYear,
}: {
  studentId: string
  tuitionPlanId?: string
  academicYear?: string
}) {
  const supabase = createClient()
  const [documents, setDocuments] = useState<TuitionDocument[]>([])
  const [linkableDocs, setLinkableDocs] = useState<TuitionDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showLinkPicker, setShowLinkPicker] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (tuitionPlanId) {
      const { data: links } = await supabase.from('tuition_document_plans').select('document_id').eq('tuition_plan_id', tuitionPlanId)
      const linkedIds = new Set((links ?? []).map(l => l.document_id))
      const { data: allDocs } = await supabase.from('tuition_documents').select('*').eq('student_id', studentId).order('uploaded_at', { ascending: false })
      setDocuments((allDocs ?? []).filter(d => linkedIds.has(d.id)))
      setLinkableDocs((allDocs ?? []).filter(d => !linkedIds.has(d.id)))
    } else {
      const { data: docs } = await supabase.from('tuition_documents').select('*').eq('student_id', studentId).order('uploaded_at', { ascending: false })
      setDocuments(docs ?? [])
    }
    setLoading(false)
  }, [studentId, tuitionPlanId, supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
  useEffect(() => { load() }, [load])

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const path = `${studentId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file)
      if (uploadError) { alert(`Failed to upload ${file.name}: ${uploadError.message}`); continue }
      const { data: doc, error: insertError } = await supabase.from('tuition_documents').insert([{
        student_id: studentId, file_name: file.name, file_path: path,
        file_size: file.size, content_type: file.type || null, academic_year: academicYear ?? null,
      }]).select('id').single()
      if (insertError) { alert(`Failed to save ${file.name}: ${insertError.message}`); continue }
      if (tuitionPlanId && doc) {
        await supabase.from('tuition_document_plans').insert([{ document_id: doc.id, tuition_plan_id: tuitionPlanId }])
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    load()
  }

  async function viewDocument(doc: TuitionDocument) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60)
    if (error || !data) { alert('Could not open this document.'); return }
    window.open(data.signedUrl, '_blank')
  }

  async function deleteDocument(doc: TuitionDocument) {
    if (!confirm(`Delete "${doc.file_name}"? This removes it everywhere it's linked, not just here.`)) return
    await supabase.storage.from(BUCKET).remove([doc.file_path])
    await supabase.from('tuition_documents').delete().eq('id', doc.id)
    load()
  }

  async function unlinkFromPlan(doc: TuitionDocument) {
    if (!tuitionPlanId) return
    await supabase.from('tuition_document_plans').delete().eq('document_id', doc.id).eq('tuition_plan_id', tuitionPlanId)
    load()
  }

  async function linkExisting(docId: string) {
    if (!tuitionPlanId) return
    await supabase.from('tuition_document_plans').insert([{ document_id: docId, tuition_plan_id: tuitionPlanId }])
    setShowLinkPicker(false)
    load()
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-700">Documents</span>
          <span className="text-xs text-slate-400">
            {tuitionPlanId ? 'linked to this plan' : "on file for this student, any plan/year"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {tuitionPlanId && (
            <button onClick={() => setShowLinkPicker(s => !s)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
              <Link2 size={13} /> Link Existing
            </button>
          )}
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50">
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {uploading ? 'Uploading…' : 'Upload New'}
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden"
            accept="application/pdf,image/*,.doc,.docx"
            onChange={e => handleUpload(e.target.files)} />
        </div>
      </div>

      {showLinkPicker && (
        <div className="mb-3 border border-blue-200 bg-blue-50 rounded-lg p-3">
          <p className="text-xs font-medium text-blue-800 mb-2">Link a document already uploaded for this student:</p>
          {linkableDocs.length === 0 ? (
            <p className="text-xs text-blue-600">No other documents on file to link — upload a new one instead.</p>
          ) : (
            <div className="space-y-1">
              {linkableDocs.map(doc => (
                <div key={doc.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-1.5">
                  <span className="text-xs text-slate-700 truncate">
                    {doc.file_name}{doc.academic_year ? ` (${doc.academic_year})` : ''}
                  </span>
                  <button onClick={() => linkExisting(doc.id)} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex-shrink-0 ml-2">
                    Link
                  </button>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setShowLinkPicker(false)} className="text-xs text-blue-400 hover:text-blue-600 mt-2">Close</button>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-slate-400 py-1">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="text-xs text-slate-400 py-1">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {documents.map(doc => (
            <div key={doc.id} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <button onClick={() => viewDocument(doc)} className="text-sm text-slate-800 hover:text-blue-600 font-medium truncate block text-left">
                  {doc.file_name}
                </button>
                <p className="text-xs text-slate-400">
                  {doc.academic_year ? `${doc.academic_year} · ` : ''}
                  {new Date(doc.uploaded_at).toLocaleDateString()}
                  {doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => viewDocument(doc)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View">
                  <Eye size={14} />
                </button>
                {tuitionPlanId && (
                  <button onClick={() => unlinkFromPlan(doc)} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Unlink from this plan (keeps the document)">
                    <Unlink size={14} />
                  </button>
                )}
                <button onClick={() => deleteDocument(doc)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete document entirely">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
