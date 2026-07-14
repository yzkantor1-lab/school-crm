export type ExportColumn = {
  header: string
  key: string
  format?: (val: any) => string
}

// ── CSV ────────────────────────────────────────────────────────────────────────
export function exportToCSV(data: Record<string, any>[], columns: ExportColumn[], filename: string) {
  const headers = columns.map(c => `"${c.header}"`).join(',')
  const rows = data.map(row =>
    columns.map(c => {
      const raw = row[c.key] ?? ''
      const val = c.format ? c.format(raw) : String(raw)
      return `"${val.replace(/"/g, '""')}"`
    }).join(',')
  )
  const csv = [headers, ...rows].join('\n')
  download(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`)
}

// ── PDF ────────────────────────────────────────────────────────────────────────
export async function exportToPDF(
  data: Record<string, any>[],
  columns: ExportColumn[],
  filename: string,
  title?: string,
) {
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
    body: data.map(row =>
      columns.map(c => {
        const raw = row[c.key] ?? ''
        return c.format ? c.format(raw) : String(raw)
      })
    ),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  })

  doc.save(`${filename}.pdf`)
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}
