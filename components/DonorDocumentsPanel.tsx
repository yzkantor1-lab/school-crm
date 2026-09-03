'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Upload, FileText, Trash2, Loader2, Eye } from 'lucide-react'

type DonorDocument = {
  id: string
  donor_id: string
  file_name: string
  file_path: string
  file_size: number | null
  content_type: string | null
  notes: string | null
  uploaded_at: string
}

const BUCKET = 'donor-documents'

function formatFileSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Donor-side equivalent of TuitionDocumentsPanel — no plan-linking (donors
// don't have the "plan" concept students do), otherwise the same shape:
// manual uploads, plus receipts sent/printed from this page auto-archive
// here too (see lib/documentArchive.ts) so it doubles as a record of
// what's actually been sent to this donor.
export default function DonorDocumentsPanel({ donorId }: { donorId: string }) {
  const supabase = createClient()
  const [documents, setDocuments] = useState<DonorDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('donor_documents').select('*').eq('donor_id', donorId).order('uploaded_at', { ascending: false })
    setDocuments(data ?? [])
    setLoading(false)
  }, [donorId, supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
  useEffect(() => { load() }, [load])

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const path = `${donorId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file)
      if (uploadError) { alert(`Failed to upload ${file.name}: ${uploadError.message}`); continue }
      const { error: insertError } = await supabase.from('donor_documents').insert([{
        donor_id: donorId, file_name: file.name, file_path: path,
        file_size: file.size, content_type: file.type || null,
      }])
      if (insertError) alert(`Failed to save ${file.name}: ${insertError.message}`)
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    load()
  }

  async function viewDocument(doc: DonorDocument) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60)
    if (error || !data) { alert('Could not open this document.'); return }
    window.open(data.signedUrl, '_blank')
  }

  async function deleteDocument(doc: DonorDocument) {
    if (!confirm(`Delete "${doc.file_name}"?`)) return
    await supabase.storage.from(BUCKET).remove([doc.file_path])
    await supabase.from('donor_documents').delete().eq('id', doc.id)
    load()
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-700">Documents</span>
          <span className="text-xs text-slate-400">on file for this donor</span>
        </div>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50">
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {uploading ? 'Uploading…' : 'Upload New'}
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden"
          accept="application/pdf,image/*,.doc,.docx"
          onChange={e => handleUpload(e.target.files)} />
      </div>

      {loading ? (
        <p className="text-xs text-slate-400 py-1">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="text-xs text-slate-400 py-1">No documents on file yet.</p>
      ) : (
        <div className="space-y-1.5">
          {documents.map(doc => (
            <div key={doc.id} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <button onClick={() => viewDocument(doc)} className="text-sm text-slate-800 hover:text-blue-600 font-medium truncate block text-left">
                  {doc.file_name}
                </button>
                <p className="text-xs text-slate-400">
                  {new Date(doc.uploaded_at).toLocaleDateString()}
                  {doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ''}
                  {doc.notes ? ` · ${doc.notes}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => viewDocument(doc)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View">
                  <Eye size={14} />
                </button>
                <button onClick={() => deleteDocument(doc)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete document">
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
