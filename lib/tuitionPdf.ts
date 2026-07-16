/* eslint-disable @typescript-eslint/no-explicit-any -- jspdf-autotable types its jsPDF document param as `any` upstream (see jspdf-autotable/dist/index.d.ts); no more precise type is available for the `doc` handle used throughout this file. */

import { drawLetterheadHeader, drawLetterheadFooter } from './letterhead'
import { openPreviewTab, showPdfPreview } from './pdfPreview'

export type BillStudent = {
  first_name: string | null
  last_name: string | null
  grade_level: string | null
  student_id: string | null
  parents_title: string | null
}

export type BillPlan = {
  academic_year: string | null
  total_amount: number | null
  discount_amount: number | null
  building_fund_amount: number | null
  payment_structure: string | null
}

export type BillPayment = {
  amount: number
  due_date: string | null
  payment_date: string | null
  status: string
  payment_method: string | null
  payment_type: string | null
  transaction_id?: string | null
}

type SemesterRow = { label: string; dates: string; amount: number; enrolled: boolean }

type BillOpts = {
  student: BillStudent
  plan: BillPlan
  payments: BillPayment[]
  semesterRows?: SemesterRow[]
  paymentMethodLabel: (v: string | null) => string
}

type ReceiptOpts = {
  student: BillStudent
  plan: BillPlan
  payment: BillPayment
  balanceAfter: number
  paymentMethodLabel: (v: string | null) => string
}

function studentName(s: BillStudent) {
  return [s.first_name, s.last_name].filter(Boolean).join(' ') || 'Student'
}

function paymentTypeLabel(t: string | null | undefined) {
  return t === 'building_fund' ? 'Building Fund' : t === 'donation' ? 'Donation' : 'Tuition'
}

// Raw base64 (no "data:application/pdf;...;base64," prefix) suitable for email attachments.
function docToBase64(doc: any): string {
  const dataUri = doc.output('datauristring') as string
  return dataUri.slice(dataUri.indexOf(',') + 1)
}

// ── Tuition Bill / Statement ────────────────────────────────────────────────

async function buildBillDoc(opts: BillOpts): Promise<{ doc: any; filename: string }> {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'portrait' })

  const name = studentName(opts.student)
  const netTuition = Number(opts.plan.total_amount ?? 0) - Number(opts.plan.discount_amount ?? 0)
  const buildingFund = Number(opts.plan.building_fund_amount ?? 0)
  const tuitionPaid = opts.payments
    .filter(p => p.status === 'paid' && (p.payment_type ?? 'tuition') === 'tuition')
    .reduce((s, p) => s + Number(p.amount), 0)
  const buildingFundPaid = opts.payments
    .filter(p => p.status === 'paid' && p.payment_type === 'building_fund')
    .reduce((s, p) => s + Number(p.amount), 0)
  const tuitionBalance = netTuition - tuitionPaid
  const buildingFundBalance = buildingFund - buildingFundPaid
  const totalBalance = tuitionBalance + buildingFundBalance

  let y = drawLetterheadHeader(doc, 'TUITION STATEMENT')

  if (totalBalance > 0) {
    const title = opts.student.parents_title ? `${opts.student.parents_title} ` : ''
    const salutation = `Dear ${title}${opts.student.last_name || ''},`
    const paragraphs = [
      `You currently have an outstanding balance of $${totalBalance.toFixed(2)} on your tuition account. Please remit your payment as soon as possible.`,
      'If you have any questions, please call Rabbi Kantor at 732-800-1011, extension 2.',
      'Thank you.',
    ]

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(salutation, 14, y)
    y += 7

    const wrapWidth = doc.internal.pageSize.getWidth() - 28
    for (const para of paragraphs) {
      const lines = doc.splitTextToSize(para, wrapWidth)
      doc.text(lines, 14, y)
      y += lines.length * 5 + 4
    }
    y += 4
  }

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(name, 14, y)
  doc.setFont('helvetica', 'normal')
  const infoBits = [opts.student.grade_level, opts.student.student_id ? `ID: ${opts.student.student_id}` : null]
    .filter(Boolean).join('  ·  ')
  if (infoBits) doc.text(infoBits, 14, y + 5)
  doc.text(`Academic Year: ${opts.plan.academic_year || '—'}`, 14, y + 10)
  y += 20

  if (opts.semesterRows && opts.semesterRows.length) {
    autoTable(doc, {
      startY: y,
      head: [['Semester', 'Dates', 'Amount']],
      body: opts.semesterRows.map(r => [r.label + (r.enrolled ? '' : ' (not enrolled)'), r.dates, `$${r.amount.toFixed(2)}`]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
    })
    y = (doc as any).lastAutoTable.finalY + 8
  } else if (opts.plan.payment_structure) {
    doc.setFont('helvetica', 'normal')
    doc.text(
      `Payment Structure: ${opts.plan.payment_structure.charAt(0).toUpperCase()}${opts.plan.payment_structure.slice(1)}`,
      14, y,
    )
    y += 8
  }

  const summaryRows: [string, string][] = []
  const boldRows = new Set<number>()
  function pushRow(label: string, value: string, bold?: boolean) {
    if (bold) boldRows.add(summaryRows.length)
    summaryRows.push([label, value])
  }

  pushRow('Tuition Charges', `$${Number(opts.plan.total_amount ?? 0).toFixed(2)}`)
  if (Number(opts.plan.discount_amount ?? 0) > 0) {
    pushRow('Discount', `-$${Number(opts.plan.discount_amount).toFixed(2)}`)
  }
  pushRow('Tuition Paid', `$${tuitionPaid.toFixed(2)}`)
  pushRow('Tuition Balance', tuitionBalance > 0 ? `$${tuitionBalance.toFixed(2)}` : 'Paid in Full', true)

  if (buildingFund > 0) {
    pushRow('Building Fund Charge', `$${buildingFund.toFixed(2)}`)
    pushRow('Building Fund Paid', `$${buildingFundPaid.toFixed(2)}`)
    pushRow('Building Fund Balance', buildingFundBalance > 0 ? `$${buildingFundBalance.toFixed(2)}` : 'Paid in Full', true)
  }

  const totalRowIndex = summaryRows.length
  pushRow('Total Balance Due', totalBalance > 0 ? `$${totalBalance.toFixed(2)}` : 'Paid in Full', true)

  autoTable(doc, {
    startY: y,
    body: summaryRows,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
    margin: { left: 100, right: 14 },
    didParseCell: (data: any) => {
      if (boldRows.has(data.row.index)) {
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.row.index === totalRowIndex) {
        data.cell.styles.fontSize = 12
        data.cell.styles.textColor = totalBalance > 0 ? [220, 38, 38] : [22, 163, 74]
      }
    },
  })
  y = (doc as any).lastAutoTable.finalY + 10

  const billablePayments = opts.payments.filter(p => p.payment_type !== 'donation')
  if (billablePayments.length) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Payment History', 14, y)
    y += 4
    autoTable(doc, {
      startY: y,
      head: [['Due Date', 'Paid Date', 'Amount', 'For', 'Status', 'Method']],
      body: billablePayments.map(p => [
        p.due_date ? new Date(p.due_date + 'T00:00:00').toLocaleDateString() : '—',
        p.payment_date ? new Date(p.payment_date + 'T00:00:00').toLocaleDateString() : '—',
        `$${Number(p.amount).toFixed(2)}`,
        paymentTypeLabel(p.payment_type),
        p.status.charAt(0).toUpperCase() + p.status.slice(1),
        opts.paymentMethodLabel(p.payment_method),
      ]),
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [100, 116, 139], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
    })
  }

  drawLetterheadFooter(doc)

  const filename = `tuition-statement-${name.replace(/\s+/g, '-').toLowerCase()}-${(opts.plan.academic_year || '').replace(/\s+/g, '')}.pdf`
  return { doc, filename }
}

export async function generateTuitionBillPDF(opts: BillOpts) {
  const win = openPreviewTab()
  const { doc } = await buildBillDoc(opts)
  showPdfPreview(doc, win)
}

export async function getTuitionBillPdfBase64(opts: BillOpts): Promise<{ base64: string; filename: string }> {
  const { doc, filename } = await buildBillDoc(opts)
  return { base64: docToBase64(doc), filename }
}

// ── Payment Receipt ──────────────────────────────────────────────────────────

async function buildReceiptDoc(opts: ReceiptOpts): Promise<{ doc: any; filename: string }> {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'portrait' })

  const name = studentName(opts.student)
  const isDonation = opts.payment.payment_type === 'donation'

  const headerY = drawLetterheadHeader(doc, isDonation ? 'DONATION RECEIPT' : 'PAYMENT RECEIPT')
  const typeLabel = paymentTypeLabel(opts.payment.payment_type)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(name, 14, headerY)
  doc.setFont('helvetica', 'normal')
  doc.text(`Academic Year: ${opts.plan.academic_year || '—'}`, 14, headerY + 5)

  const rows: [string, string][] = [
    ['Amount', `$${Number(opts.payment.amount).toFixed(2)}`],
    ['Payment Date', opts.payment.payment_date ? new Date(opts.payment.payment_date + 'T00:00:00').toLocaleDateString() : '—'],
    ['Payment Method', opts.paymentMethodLabel(opts.payment.payment_method)],
  ]
  if (opts.payment.transaction_id) rows.push(['Check / Transaction #', opts.payment.transaction_id])
  rows.push([isDonation ? 'Type' : 'Applied To', typeLabel])

  autoTable(doc, {
    startY: headerY + 14,
    body: rows,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })
  let y = (doc as any).lastAutoTable.finalY + 8

  if (!isDonation) {
    autoTable(doc, {
      startY: y,
      body: [['Remaining Balance', opts.balanceAfter > 0 ? `$${opts.balanceAfter.toFixed(2)}` : 'Paid in Full']],
      theme: 'plain',
      styles: { fontSize: 12, cellPadding: 3, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right', textColor: opts.balanceAfter > 0 ? [220, 38, 38] : [22, 163, 74] } },
      margin: { left: 14, right: 14 },
    })
    y = (doc as any).lastAutoTable.finalY + 8
  }

  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(isDonation ? 'Thank you for your generous donation.' : 'Thank you for your payment.', 14, y + 4)
  doc.setTextColor(0)

  drawLetterheadFooter(doc)

  const dateForFilename = opts.payment.payment_date || opts.payment.due_date || 'undated'
  const filename = `${isDonation ? 'donation' : 'payment'}-receipt-${name.replace(/\s+/g, '-').toLowerCase()}-${dateForFilename}.pdf`
  return { doc, filename }
}

export async function generatePaymentReceiptPDF(opts: ReceiptOpts) {
  const win = openPreviewTab()
  const { doc } = await buildReceiptDoc(opts)
  showPdfPreview(doc, win)
}

export async function getPaymentReceiptPdfBase64(opts: ReceiptOpts): Promise<{ base64: string; filename: string }> {
  const { doc, filename } = await buildReceiptDoc(opts)
  return { base64: docToBase64(doc), filename }
}
