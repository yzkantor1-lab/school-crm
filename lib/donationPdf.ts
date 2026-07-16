/* eslint-disable @typescript-eslint/no-explicit-any -- jspdf-autotable types its jsPDF document param as `any` upstream (see lib/tuitionPdf.ts for the same note); no more precise type is available for the `doc` handle used throughout this file. */

import { drawLetterheadHeader, drawLetterheadFooter } from './letterhead'
import { openPreviewTab, showPdfPreview } from './pdfPreview'

export type ReceiptDonor = {
  name: string
  email: string | null
  address: string | null
}

export type ReceiptDonation = {
  amount: number
  donation_date: string
  donation_method: string
  purpose: string
  notes: string | null
}

type DonationReceiptOpts = {
  donor: ReceiptDonor
  donation: ReceiptDonation
  extraNote?: string
}

// Raw base64 (no "data:application/pdf;...;base64," prefix) suitable for email attachments.
function docToBase64(doc: any): string {
  const dataUri = doc.output('datauristring') as string
  return dataUri.slice(dataUri.indexOf(',') + 1)
}

async function buildDonationReceiptDoc(opts: DonationReceiptOpts): Promise<{ doc: any; filename: string }> {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'portrait' })

  const headerY = drawLetterheadHeader(doc, 'DONATION RECEIPT')

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(opts.donor.name, 14, headerY)
  doc.setFont('helvetica', 'normal')
  let addrY = headerY + 5
  if (opts.donor.address) {
    doc.text(opts.donor.address, 14, addrY)
    addrY += 5
  }
  if (opts.donor.email) {
    doc.text(opts.donor.email, 14, addrY)
    addrY += 5
  }

  const rows: [string, string][] = [
    ['Amount', `$${Number(opts.donation.amount).toFixed(2)}`],
    ['Date', new Date(opts.donation.donation_date + 'T00:00:00').toLocaleDateString()],
    ['Method', opts.donation.donation_method],
    ['Purpose', opts.donation.purpose],
  ]
  if (opts.donation.notes) rows.push(['Notes', opts.donation.notes])

  autoTable(doc, {
    startY: addrY + 6,
    body: rows,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })
  const y = (doc as any).lastAutoTable.finalY + 14

  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  doc.text(
    'No goods or services were provided in exchange for this contribution.\nPlease retain this receipt for your tax records.',
    14, y,
  )

  doc.setFont('helvetica', 'normal')
  doc.text('Thank you for your generous support.', 14, y + 16)

  if (opts.extraNote) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(80)
    const wrapWidth = doc.internal.pageSize.getWidth() - 28
    doc.text(doc.splitTextToSize(`Note: ${opts.extraNote}`, wrapWidth), 14, y + 28)
    doc.setTextColor(0)
    doc.setFont('helvetica', 'normal')
  }

  drawLetterheadFooter(doc)

  const filename = `donation-receipt-${opts.donor.name.replace(/\s+/g, '-').toLowerCase()}-${opts.donation.donation_date}.pdf`
  return { doc, filename }
}

export async function generateDonationReceiptPDF(opts: DonationReceiptOpts) {
  const win = openPreviewTab()
  const { doc } = await buildDonationReceiptDoc(opts)
  showPdfPreview(doc, win)
}

export async function getDonationReceiptPdfBase64(opts: DonationReceiptOpts): Promise<{ base64: string; filename: string }> {
  const { doc, filename } = await buildDonationReceiptDoc(opts)
  return { base64: docToBase64(doc), filename }
}
