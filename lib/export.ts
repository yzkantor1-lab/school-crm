export type ExportColumn = {
  header: string
  key: string
  format?: (val: never) => string
}

function cellsFor(data: Record<string, unknown>[], columns: ExportColumn[]): string[][] {
  return data.map(row =>
    columns.map(c => {
      const raw = row[c.key] ?? ''
      return c.format ? c.format(raw as never) : String(raw)
    })
  )
}

// UTF-8-safe base64 — plain btoa() chokes on any non-Latin1 character (an
// accented name, a curly quote pasted from Word), which real school data
// hits often enough that skipping this would silently break attachments.
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  bytes.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary)
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

// ── CSV ────────────────────────────────────────────────────────────────────────
function csvContent(data: Record<string, unknown>[], columns: ExportColumn[]): string {
  const headers = columns.map(c => `"${c.header}"`).join(',')
  const rows = cellsFor(data, columns).map(cells =>
    cells.map(val => `"${val.replace(/"/g, '""')}"`).join(',')
  )
  return [headers, ...rows].join('\n')
}

export function exportToCSV(data: Record<string, unknown>[], columns: ExportColumn[], filename: string) {
  download(new Blob([csvContent(data, columns)], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`)
}

export function getExportCsvBase64(data: Record<string, unknown>[], columns: ExportColumn[]): string {
  return toBase64(csvContent(data, columns))
}

// ── PDF ────────────────────────────────────────────────────────────────────────
async function buildPdfDoc(data: Record<string, unknown>[], columns: ExportColumn[], title?: string) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' })

  if (title) {
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text(title, 14, 18)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120)
    doc.text(`Exported ${new Date().toLocaleDateString()}  ·  ${data.length} record${data.length !== 1 ? 's' : ''}`, 14, 25)
    doc.setTextColor(0)
  }

  autoTable(doc, {
    startY: title ? 30 : 14,
    head: [columns.map(c => c.header)],
    body: cellsFor(data, columns),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  })

  return doc
}

export async function exportToPDF(
  data: Record<string, unknown>[],
  columns: ExportColumn[],
  filename: string,
  title?: string,
) {
  const doc = await buildPdfDoc(data, columns, title)
  doc.save(`${filename}.pdf`)
}

export async function getExportPdfBase64(
  data: Record<string, unknown>[],
  columns: ExportColumn[],
  title?: string,
): Promise<string> {
  const doc = await buildPdfDoc(data, columns, title)
  const dataUri = doc.output('datauristring') as string
  return dataUri.slice(dataUri.indexOf(',') + 1)
}
