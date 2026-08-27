'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Upload, FileStack, Trash2, Loader2, Check, AlertCircle, Search,
  ChevronRight, Send, Eye,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

type Template = { id: string; name: string; file_path: string; merge_fields: string[]; created_at: string }
type Audience = 'student' | 'donor'
type FieldMode = 'crm' | 'fixed' | 'manual'

type StudentRecipient = {
  id: string; first_name: string; last_name: string
  father_name: string | null; mother_name: string | null
  father_email: string | null; mother_email: string | null
  address: string | null; grade_level: string | null
}
type DonorRecipient = {
  id: string; name: string; title: string | null
  email: string | null; phone_number: string | null; address: string | null
}
type Recipient = { id: string; label: string; email: string | null; raw: StudentRecipient | DonorRecipient }

type GenerateResult = { recipientId: string; ok: boolean; error?: string; documentId?: string; fileName?: string }
type EmailAccountOption = { id: string; label: string; email: string; is_default: boolean }

// No Buffer in the browser — this is the standard ArrayBuffer -> base64
// conversion for client-side code.
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

const STUDENT_CRM_FIELDS: { key: string; label: string; get: (s: StudentRecipient) => string }[] = [
  { key: 'first_name', label: 'Student First Name', get: s => s.first_name || '' },
  { key: 'last_name', label: 'Student/Parent Last Name', get: s => s.last_name || '' },
  { key: 'father_name', label: "Father's First Name", get: s => s.father_name || '' },
  { key: 'mother_name', label: "Mother's First Name", get: s => s.mother_name || '' },
  { key: 'email', label: 'Email (father, else mother)', get: s => s.father_email || s.mother_email || '' },
  { key: 'address', label: 'Address', get: s => s.address || '' },
  { key: 'grade_level', label: 'Grade Level', get: s => s.grade_level || '' },
]
const DONOR_CRM_FIELDS: { key: string; label: string; get: (d: DonorRecipient) => string }[] = [
  { key: 'name', label: 'Donor Name', get: d => d.name || '' },
  { key: 'title', label: 'Title', get: d => d.title || '' },
  { key: 'email', label: 'Email', get: d => d.email || '' },
  { key: 'phone', label: 'Phone', get: d => d.phone_number || '' },
  { key: 'address', label: 'Address', get: d => d.address || '' },
]

export default function MailMergePage() {
  const supabase = createClient()

  const [templates, setTemplates] = useState<Template[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [uploadName, setUploadName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) ?? null

  const [audience, setAudience] = useState<Audience>('student')
  const [students, setStudents] = useState<StudentRecipient[]>([])
  const [donors, setDonors] = useState<DonorRecipient[]>([])
  const [loadingRecipients, setLoadingRecipients] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [fieldMode, setFieldMode] = useState<Record<string, FieldMode>>({})
  const [fieldCrmKey, setFieldCrmKey] = useState<Record<string, string>>({})
  const [fieldFixedValue, setFieldFixedValue] = useState<Record<string, string>>({})
  const [manualValues, setManualValues] = useState<Record<string, Record<string, string>>>({}) // recipientId -> field -> value

  const [convertToPdf, setConvertToPdf] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generateResults, setGenerateResults] = useState<GenerateResult[]>([])

  const [accounts, setAccounts] = useState<EmailAccountOption[]>([])
  const [sendAccountId, setSendAccountId] = useState('')
  const [sendSubject, setSendSubject] = useState('')
  const [sendBody, setSendBody] = useState('')
  const [attachPdf, setAttachPdf] = useState(true)
  const [attachDocx, setAttachDocx] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResults, setSendResults] = useState<Record<string, { ok: boolean; error?: string }>>({})

  const crmFields = audience === 'student' ? STUDENT_CRM_FIELDS : DONOR_CRM_FIELDS

  // ── Load templates + email accounts ─────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    const res = await fetch('/api/mail-merge/templates')
    const json = await res.json()
    setTemplates(json.templates ?? [])
    setLoadingTemplates(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
  useEffect(() => { loadTemplates() }, [loadTemplates])

  useEffect(() => {
    supabase.from('email_accounts').select('id,label,email,is_default').order('is_default', { ascending: false }).order('label').then(({ data }) => {
      setAccounts(data ?? [])
      const def = (data ?? []).find(a => a.is_default)
      if (def) setSendAccountId(def.id)
    })
  }, [supabase])

  // ── Load recipients when audience changes ───────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- driven by an external dependency (audience) change, not derivable state
    setLoadingRecipients(true)
    setSelectedIds(new Set())
    if (audience === 'student') {
      supabase.from('students')
        .select('id,first_name,last_name,father_name,mother_name,father_email,mother_email,address,grade_level')
        .eq('status', 'active').order('last_name')
        .then(({ data }) => { setStudents(data ?? []); setLoadingRecipients(false) })
    } else {
      supabase.from('donors')
        .select('id,name,title,email,phone_number,address')
        .order('name')
        .then(({ data }) => { setDonors(data ?? []); setLoadingRecipients(false) })
    }
  }, [audience, supabase])

  // Reset merge-job state (but not templates/accounts) whenever the template changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- driven by an external dependency (selectedTemplateId) change, not derivable state
    setFieldMode({}); setFieldCrmKey({}); setFieldFixedValue({}); setManualValues({})
    setGenerateResults([]); setSendResults({})
  }, [selectedTemplateId])

  const recipients: Recipient[] = useMemo(() => {
    if (audience === 'student') {
      return students.map(s => ({ id: s.id, label: `${s.first_name} ${s.last_name}`, email: s.father_email || s.mother_email, raw: s }))
    }
    return donors.map(d => ({ id: d.id, label: d.name, email: d.email, raw: d }))
  }, [audience, students, donors])

  const visibleRecipients = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return recipients
    return recipients.filter(r => r.label.toLowerCase().includes(q))
  }, [recipients, search])

  const selectedRecipients = recipients.filter(r => selectedIds.has(r.id))

  function toggleRecipient(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAllVisible() {
    setSelectedIds(prev => new Set([...prev, ...visibleRecipients.map(r => r.id)]))
  }
  function clearSelection() { setSelectedIds(new Set()) }

  // ── Template upload ──────────────────────────────────────────────────────
  async function uploadTemplate() {
    const file = fileInputRef.current?.files?.[0]
    if (!file || !uploadName.trim()) { setUploadError('Pick a .docx file and give it a name.'); return }
    setUploading(true); setUploadError('')
    const form = new FormData()
    form.append('file', file)
    form.append('name', uploadName.trim())
    const res = await fetch('/api/mail-merge/templates', { method: 'POST', body: form })
    const json = await res.json()
    setUploading(false)
    if (!res.ok) { setUploadError(json.error || 'Upload failed.'); return }
    setUploadName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    await loadTemplates()
    setSelectedTemplateId(json.template.id)
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template? Documents already generated from it are unaffected.')) return
    await fetch(`/api/mail-merge/templates/${id}`, { method: 'DELETE' })
    if (selectedTemplateId === id) setSelectedTemplateId('')
    await loadTemplates()
  }

  // ── Field value resolution ───────────────────────────────────────────────
  function resolveValue(field: string, recipient: Recipient): string {
    const mode = fieldMode[field] ?? 'manual'
    if (mode === 'fixed') return fieldFixedValue[field] ?? ''
    if (mode === 'crm') {
      const crmField = crmFields.find(f => f.key === (fieldCrmKey[field] ?? crmFields[0]?.key))
      if (!crmField) return ''
      return audience === 'student'
        ? (crmField as typeof STUDENT_CRM_FIELDS[number]).get(recipient.raw as StudentRecipient)
        : (crmField as typeof DONOR_CRM_FIELDS[number]).get(recipient.raw as DonorRecipient)
    }
    return manualValues[recipient.id]?.[field] ?? ''
  }

  function setManualValue(recipientId: string, field: string, value: string) {
    setManualValues(prev => ({ ...prev, [recipientId]: { ...prev[recipientId], [field]: value } }))
  }

  const hasManualFields = selectedTemplate?.merge_fields.some(f => (fieldMode[f] ?? 'manual') === 'manual') ?? false

  // ── Generate ─────────────────────────────────────────────────────────────
  async function generate() {
    if (!selectedTemplate || !selectedRecipients.length) return
    setGenerating(true)
    const payload = {
      templateId: selectedTemplate.id,
      convertToPdf,
      recipients: selectedRecipients.map(r => ({
        type: audience,
        id: r.id,
        fileNameBase: r.label,
        values: Object.fromEntries(selectedTemplate.merge_fields.map(f => [f, resolveValue(f, r)])),
      })),
    }
    const res = await fetch('/api/mail-merge/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const json = await res.json()
    setGenerating(false)
    setGenerateResults(json.results ?? [])
  }

  const generatedOk = generateResults.filter(r => r.ok)

  // ── Send ─────────────────────────────────────────────────────────────────
  async function sendAll() {
    setSending(true)
    const nextResults: Record<string, { ok: boolean; error?: string }> = {}
    for (const result of generatedOk) {
      const recipient = recipients.find(r => r.id === result.recipientId)
      if (!recipient?.email) { nextResults[result.recipientId] = { ok: false, error: 'No email on file.' }; continue }

      const { data: doc } = await supabase.from('merge_documents').select('file_path,pdf_file_path,file_name').eq('id', result.documentId).single()
      if (!doc) { nextResults[result.recipientId] = { ok: false, error: 'Document not found.' }; continue }

      const attachments: { filename: string; content: string; contentType: string }[] = []
      if (attachDocx) {
        const { data: docxBlob } = await supabase.storage.from('merge-documents').download(doc.file_path)
        if (docxBlob) attachments.push({ filename: doc.file_name, content: arrayBufferToBase64(await docxBlob.arrayBuffer()), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      }
      if (attachPdf && doc.pdf_file_path) {
        const { data: pdfBlob } = await supabase.storage.from('merge-documents').download(doc.pdf_file_path)
        if (pdfBlob) attachments.push({ filename: doc.file_name.replace(/\.docx$/, '.pdf'), content: arrayBufferToBase64(await pdfBlob.arrayBuffer()), contentType: 'application/pdf' })
      }
      if (!attachments.length) { nextResults[result.recipientId] = { ok: false, error: 'No attachment available (PDF not requested/generated and docx not selected).' }; continue }

      let subject = sendSubject, body = sendBody
      if (selectedTemplate) {
        for (const f of selectedTemplate.merge_fields) {
          const v = resolveValue(f, recipient)
          subject = subject.split(`{{${f}}}`).join(v)
          body = body.split(`{{${f}}}`).join(v)
        }
      }

      try {
        const res = await fetch('/api/send-email', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: [recipient.email], subject, body, attachments, ...(sendAccountId ? { accountId: sendAccountId } : {}) }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Send failed.')
        nextResults[result.recipientId] = { ok: true }

        for (const a of attachments) {
          await supabase.from('communications').insert([{
            type: 'email', subject, body,
            student_id: audience === 'student' ? recipient.id : null,
            donor_id: audience === 'donor' ? recipient.id : null,
            recipients: recipient.email, attachment_filename: a.filename,
            sent_from_email: json.fromEmail ?? null,
          }])
        }
      } catch (err) {
        nextResults[result.recipientId] = { ok: false, error: err instanceof Error ? err.message : 'Send failed.' }
      }
      setSendResults({ ...nextResults })
    }
    setSending(false)
  }

  async function viewDocument(path: string) {
    const { data } = await supabase.storage.from('merge-documents').createSignedUrl(path, 60)
    if (data) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><FileStack size={24} className="text-blue-600" /> Mail Merge</h1>
        <p className="text-sm text-slate-500 mt-1">Upload a template, address it to students or donors, generate personalized documents, and optionally email them.</p>
      </div>

      {/* Templates */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-4">
        <p className="font-semibold text-slate-900">1. Template</p>
        {loadingTemplates ? <p className="text-xs text-slate-400">Loading…</p> : (
          <div className="space-y-1.5">
            {templates.map(t => (
              <div key={t.id} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 border cursor-pointer ${selectedTemplateId === t.id ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-100 hover:border-slate-300'}`}
                onClick={() => setSelectedTemplateId(t.id)}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{t.name}</p>
                  <p className="text-xs text-slate-400 truncate">{t.merge_fields.length ? `Fields: ${t.merge_fields.join(', ')}` : 'No {{fields}} detected'}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); deleteTemplate(t.id) }} className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg flex-shrink-0"><Trash2 size={14} /></button>
              </div>
            ))}
            {templates.length === 0 && <p className="text-xs text-slate-400">No templates yet — upload one below.</p>}
          </div>
        )}

        <div className="border-t border-slate-100 pt-3 space-y-2">
          {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <input value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="Template name (e.g. Donation Acknowledgment)"
              className="flex-1 min-w-[220px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input ref={fileInputRef} type="file" accept=".docx" className="text-xs" />
            <button disabled={uploading} onClick={uploadTemplate}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-medium">
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Upload
            </button>
          </div>
          <p className="text-xs text-slate-400">Any .docx with {'{{Field_Name}}'} placeholders anywhere in the text — they&apos;re detected automatically.</p>
        </div>
      </div>

      {selectedTemplate && (
        <>
          {/* Audience + recipients */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-4">
            <p className="font-semibold text-slate-900">2. Recipients</p>
            <div className="flex items-center gap-1 border border-slate-200 rounded-lg p-1 w-fit">
              {(['student', 'donor'] as Audience[]).map(a => (
                <button key={a} onClick={() => setAudience(a)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize ${audience === a ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  {a}s
                </button>
              ))}
            </div>

            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${audience}s…`}
                className="w-full max-w-xs border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="flex items-center gap-3 text-xs">
              <button onClick={selectAllVisible} className="text-blue-600 hover:text-blue-700 font-medium">Select all shown ({visibleRecipients.length})</button>
              <button onClick={clearSelection} className="text-slate-400 hover:text-slate-600 font-medium">Clear</button>
              <span className="text-slate-500">{selectedIds.size} selected</span>
            </div>

            {loadingRecipients ? <p className="text-xs text-slate-400">Loading…</p> : (
              <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50">
                {visibleRecipients.map(r => (
                  <label key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleRecipient(r.id)} />
                    <span className="text-slate-700">{r.label}</span>
                    {!r.email && <span className="text-amber-500 ml-auto">no email</span>}
                  </label>
                ))}
                {visibleRecipients.length === 0 && <p className="text-xs text-slate-400 px-3 py-2">No matches.</p>}
              </div>
            )}
          </div>

          {/* Field mapping */}
          {selectedTemplate.merge_fields.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-3">
              <p className="font-semibold text-slate-900">3. Field Mapping</p>
              {selectedTemplate.merge_fields.map(field => (
                <div key={field} className="flex items-center gap-2 flex-wrap border-b border-slate-50 last:border-0 pb-3 last:pb-0">
                  <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded">{'{{' + field + '}}'}</span>
                  <select value={fieldMode[field] ?? 'manual'} onChange={e => setFieldMode(prev => ({ ...prev, [field]: e.target.value as FieldMode }))}
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
                    <option value="manual">Manual — enter per recipient</option>
                    <option value="crm">CRM Field</option>
                    <option value="fixed">Fixed Value</option>
                  </select>
                  {(fieldMode[field] ?? 'manual') === 'crm' && (
                    <select value={fieldCrmKey[field] ?? crmFields[0]?.key} onChange={e => setFieldCrmKey(prev => ({ ...prev, [field]: e.target.value }))}
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
                      {crmFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  )}
                  {fieldMode[field] === 'fixed' && (
                    <input value={fieldFixedValue[field] ?? ''} onChange={e => setFieldFixedValue(prev => ({ ...prev, [field]: e.target.value }))}
                      placeholder="Same value for everyone" className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs flex-1 min-w-[160px]" />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Manual value grid */}
          {hasManualFields && selectedRecipients.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-3 overflow-x-auto">
              <p className="font-semibold text-slate-900">Manual Values</p>
              <table className="text-xs w-full">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-100">
                    <th className="pb-2 pr-3">Recipient</th>
                    {selectedTemplate.merge_fields.filter(f => (fieldMode[f] ?? 'manual') === 'manual').map(f => (
                      <th key={f} className="pb-2 pr-3 font-mono">{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedRecipients.map(r => (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-3 whitespace-nowrap text-slate-700">{r.label}</td>
                      {selectedTemplate.merge_fields.filter(f => (fieldMode[f] ?? 'manual') === 'manual').map(f => (
                        <td key={f} className="py-1.5 pr-3">
                          <input value={manualValues[r.id]?.[f] ?? ''} onChange={e => setManualValue(r.id, f, e.target.value)}
                            className="border border-slate-200 rounded px-1.5 py-1 text-xs w-32" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Generate */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-3">
            <p className="font-semibold text-slate-900">4. Generate</p>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={convertToPdf} onChange={e => setConvertToPdf(e.target.checked)} />
              Also convert to PDF (the .docx is always generated regardless)
            </label>
            <button disabled={generating || !selectedRecipients.length} onClick={generate}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
              {generating ? 'Generating…' : `Generate ${selectedRecipients.length} Document${selectedRecipients.length === 1 ? '' : 's'}`}
            </button>

            {generateResults.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-slate-100">
                {generateResults.map(r => {
                  const recipient = recipients.find(x => x.id === r.recipientId)
                  const doc = r.documentId
                  return (
                    <div key={r.recipientId} className="flex items-center gap-2 text-xs">
                      {r.ok ? <Check size={13} className="text-green-600" /> : <AlertCircle size={13} className="text-red-500" />}
                      <span className="text-slate-700">{recipient?.label}</span>
                      {r.ok ? <span className="text-green-600">generated</span> : <span className="text-red-600">{r.error}</span>}
                      {r.ok && doc && (
                        <DocLink documentId={doc} onView={viewDocument} />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Send */}
      {generatedOk.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-3">
          <p className="font-semibold text-slate-900">5. Send (optional)</p>
          {accounts.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Send From</label>
              <select value={sendAccountId} onChange={e => setSendAccountId(e.target.value)}
                className="w-full max-w-sm border border-slate-200 rounded-lg px-3 py-2 text-sm">
                {accounts.map(a => <option key={a.id} value={a.id}>{a.label} ({a.email})</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
            <input value={sendSubject} onChange={e => setSendSubject(e.target.value)} placeholder="Can use {{Field_Name}} too"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Body</label>
            <textarea value={sendBody} onChange={e => setSendBody(e.target.value)} rows={5}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y" />
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={attachPdf} onChange={e => setAttachPdf(e.target.checked)} /> Attach PDF</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={attachDocx} onChange={e => setAttachDocx(e.target.checked)} /> Attach .docx</label>
          </div>
          <button disabled={sending || !sendSubject.trim()} onClick={sendAll}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? 'Sending…' : `Send to ${generatedOk.length} Recipient${generatedOk.length === 1 ? '' : 's'}`}
          </button>
          {Object.keys(sendResults).length > 0 && (
            <div className="space-y-1 pt-2 border-t border-slate-100">
              {generatedOk.map(r => {
                const res = sendResults[r.recipientId]
                if (!res) return null
                const recipient = recipients.find(x => x.id === r.recipientId)
                return (
                  <div key={r.recipientId} className="flex items-center gap-2 text-xs">
                    {res.ok ? <Check size={13} className="text-green-600" /> : <AlertCircle size={13} className="text-red-500" />}
                    <span className="text-slate-700">{recipient?.label}</span>
                    {res.ok ? <span className="text-green-600">sent</span> : <span className="text-red-600">{res.error}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DocLink({ documentId, onView }: { documentId: string; onView: (path: string) => void }) {
  const supabase = createClient()
  async function open() {
    const { data } = await supabase.from('merge_documents').select('file_path').eq('id', documentId).single()
    if (data) onView(data.file_path)
  }
  return (
    <button onClick={open} className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium ml-1">
      <Eye size={12} /> View
    </button>
  )
}
