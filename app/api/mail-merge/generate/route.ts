import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mergeDocx } from '@/lib/mailMerge'

// A batch job with PDF conversion on (a headless Chromium render per
// recipient) can run well past Vercel's 10s default — raise the ceiling.
// 60s covers a sizable batch (e.g. 30 recipients); a Pro/Enterprise plan can
// raise this further if a single job ever needs to be larger still.
export const maxDuration = 60

const TEMPLATE_BUCKET = 'mail-merge-templates'
const DOCUMENT_BUCKET = 'merge-documents'

type RecipientInput = {
  type: 'student' | 'donor'
  id: string
  // Caller-supplied base for the generated filename (e.g. "Becher, Shimon")
  // — kept audience-agnostic here rather than this route reaching into
  // students/donors schema itself to build one.
  fileNameBase: string
  values: Record<string, string>
}

type Body = {
  templateId: string
  recipients: RecipientInput[]
  convertToPdf: boolean
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body?.templateId || !Array.isArray(body.recipients) || !body.recipients.length) {
    return NextResponse.json({ error: 'templateId and at least one recipient are required.' }, { status: 400 })
  }

  const { data: template, error: templateError } = await supabase.from('document_templates').select('*').eq('id', body.templateId).single()
  if (templateError || !template) return NextResponse.json({ error: 'Template not found.' }, { status: 404 })

  const { data: templateFile, error: downloadError } = await supabase.storage.from(TEMPLATE_BUCKET).download(template.file_path)
  if (downloadError || !templateFile) return NextResponse.json({ error: 'Could not read the template file.' }, { status: 500 })
  const templateBuffer = Buffer.from(await templateFile.arrayBuffer())

  // One shared browser for the whole batch — launching Chromium per
  // recipient doesn't scale to a real mail-merge batch (a 30-recipient job
  // could blow a serverless function's execution time limit).
  let browser: Awaited<ReturnType<typeof import('@/lib/mailMergePdf').launchBrowser>> | null = null
  let convertDocxToPdf: typeof import('@/lib/mailMergePdf').convertDocxToPdf | null = null
  if (body.convertToPdf) {
    const pdfLib = await import('@/lib/mailMergePdf')
    convertDocxToPdf = pdfLib.convertDocxToPdf
    browser = await pdfLib.launchBrowser()
  }

  const results: Array<{ recipientId: string; ok: boolean; error?: string; documentId?: string; fileName?: string }> = []

  try {
    for (const recipient of body.recipients) {
      try {
        const mergedDocx = await mergeDocx(templateBuffer, recipient.values)
        const safeBase = recipient.fileNameBase.replace(/[^a-zA-Z0-9.\-_ ]/g, '_').trim() || 'document'
        const docxFileName = `${template.name} - ${safeBase}.docx`
        const docxPath = `${recipient.type}/${recipient.id}/${crypto.randomUUID()}-${docxFileName.replace(/\s+/g, '_')}`

        const { error: docxUploadError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(docxPath, mergedDocx, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
        if (docxUploadError) throw new Error(docxUploadError.message)

        let pdfPath: string | null = null
        if (convertDocxToPdf && browser) {
          try {
            const pdfBuffer = await convertDocxToPdf(mergedDocx, browser)
            const pdfFileName = `${template.name} - ${safeBase}.pdf`
            const candidatePath = `${recipient.type}/${recipient.id}/${crypto.randomUUID()}-${pdfFileName.replace(/\s+/g, '_')}`
            const { error: pdfUploadError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(candidatePath, pdfBuffer, { contentType: 'application/pdf' })
            if (!pdfUploadError) pdfPath = candidatePath
            // A PDF conversion/upload failure never fails the whole recipient
            // — the docx above is already saved and is the source of truth.
          } catch {
            // swallow — pdfPath stays null, docx still succeeds
          }
        }

        const { data: doc, error: insertError } = await supabase.from('merge_documents').insert([{
          template_id: template.id,
          student_id: recipient.type === 'student' ? recipient.id : null,
          donor_id: recipient.type === 'donor' ? recipient.id : null,
          file_name: docxFileName,
          file_path: docxPath,
          pdf_file_path: pdfPath,
        }]).select('id').single()
        if (insertError || !doc) throw new Error(insertError?.message ?? 'Failed to save document record.')

        results.push({ recipientId: recipient.id, ok: true, documentId: doc.id, fileName: docxFileName })
      } catch (err) {
        results.push({ recipientId: recipient.id, ok: false, error: err instanceof Error ? err.message : 'Failed to generate document.' })
      }
    }
  } finally {
    if (browser) await browser.close()
  }

  return NextResponse.json({ results })
}
