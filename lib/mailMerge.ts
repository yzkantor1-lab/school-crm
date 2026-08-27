import JSZip from 'jszip'

// Core docx merge-field mechanics — generalizes the {{Field}} substitution
// first proven by hand for the 2026-2027 tuition contracts (see git history:
// generate_all_packets.py). Server-only (Node zip/XML manipulation), used by
// the mail-merge API routes.

const FIELD_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g

// Escapes a value for safe insertion into docx XML — the same handful of
// characters XML always needs escaped (docx text nodes are plain XML).
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Scans a .docx's document.xml for {{Field}} placeholders and returns the
// unique field names found, in first-appearance order. Placeholders split
// across multiple XML runs (a common Word editing artifact) won't be
// detected — same limitation the manual tuition process had; if a template
// stops finding a field that's visibly there, it was likely edited after
// being typed and needs the {{...}} retyped in one go in Word.
export async function detectMergeFields(docxBuffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(docxBuffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) throw new Error('Not a valid .docx file (missing word/document.xml).')

  const seen = new Set<string>()
  const fields: string[] = []
  for (const match of documentXml.matchAll(FIELD_PATTERN)) {
    if (!seen.has(match[1])) { seen.add(match[1]); fields.push(match[1]) }
  }
  return fields
}

// Replaces every {{Field}} occurrence (however many times it appears) with
// its value from `values`, leaving any field not present in `values`
// untouched — callers should treat unresolved placeholders in the output as
// a bug (validate detectMergeFields() output has full coverage before
// calling this), not silently ship a document with a literal "{{X}}" in it.
export async function mergeDocx(docxBuffer: Buffer, values: Record<string, string>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer)
  const documentXmlFile = zip.file('word/document.xml')
  if (!documentXmlFile) throw new Error('Not a valid .docx file (missing word/document.xml).')

  let documentXml = await documentXmlFile.async('string')
  for (const [field, value] of Object.entries(values)) {
    documentXml = documentXml.split(`{{${field}}}`).join(escapeXml(value))
  }
  zip.file('word/document.xml', documentXml)

  return zip.generateAsync({ type: 'nodebuffer' })
}
