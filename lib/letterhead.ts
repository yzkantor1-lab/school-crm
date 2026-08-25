/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF's document type is `any` upstream (see lib/tuitionPdf.ts for the same note); no more precise type is available for the `doc` handle used here. */

// Official letterhead for Yeshiva Nesiv HaTalmud (ישיבה נתיב התלמוד), matching
// the school's letterhead stationery. jsPDF's built-in fonts don't support
// Hebrew glyphs, so the letterhead (which is mostly Hebrew) is rendered onto
// an HTML canvas — which uses the browser's own font engine and handles
// Hebrew natively — and the result is embedded into the PDF as an image.
// Only works in the browser (canvas requires `document`); called exclusively
// from client-side PDF generation.

const LETTERHEAD_WIDTH = 700
const LETTERHEAD_HEIGHT = 150
const LETTERHEAD_ASPECT_RATIO = LETTERHEAD_HEIGHT / LETTERHEAD_WIDTH

export const LETTERHEAD_FOOTER_LINE1 = 'Mailing address: 700 5th Avenue • Toms River New Jersey 08757 • 732-800-1011'
export const LETTERHEAD_FOOTER_LINE2 = 'Email Address: nesivhatalmud@gmail.com'

const LETTERHEAD_IMG_WIDTH = 130
const LETTERHEAD_IMG_HEIGHT = LETTERHEAD_IMG_WIDTH * LETTERHEAD_ASPECT_RATIO
const LETTERHEAD_TITLE_Y = 8 + LETTERHEAD_IMG_HEIGHT + 10

// Where body content should start on any page that opens with a freshly-
// drawn header — same value drawLetterheadHeader() returns, exported so
// autoTable's per-page `margin.top` (below) can reserve exactly this much
// space on continuation pages it creates on its own.
export const LETTERHEAD_CONTENT_START_Y = LETTERHEAD_TITLE_Y + 10

// Bottom space to reserve so a table's last row on any page never runs
// into the footer drawn at pageHeight - 16.
export const LETTERHEAD_FOOTER_RESERVED_HEIGHT = 24

let cachedLetterheadDataUrl: string | null = null

function renderLetterheadCanvas(): string {
  const scale = 3
  const canvas = document.createElement('canvas')
  canvas.width = LETTERHEAD_WIDTH * scale
  canvas.height = LETTERHEAD_HEIGHT * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, LETTERHEAD_WIDTH, LETTERHEAD_HEIGHT)
  ctx.fillStyle = '#000000'

  const cx = LETTERHEAD_WIDTH / 2

  ctx.textAlign = 'center'
  ctx.font = 'bold 32px Arial, sans-serif'
  ctx.fillText('ישיבה נתיב התלמוד', cx, 42)

  ctx.font = '17px Arial, sans-serif'
  ctx.fillText('1011 Cross St. • Lakewood NJ 08701', cx, 68)

  ctx.beginPath()
  ctx.moveTo(80, 84)
  ctx.lineTo(LETTERHEAD_WIDTH - 80, 84)
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.textAlign = 'right'
  ctx.font = 'bold 16px Arial, sans-serif'
  ctx.fillText('בס"ד', LETTERHEAD_WIDTH - 80, 100)

  ctx.textAlign = 'left'
  ctx.font = 'bold 17px Arial, sans-serif'
  ctx.fillText('הרב משה ריידעל', 80, 116)
  ctx.fillText('ראש הישיבה', 80, 138)

  return canvas.toDataURL('image/png')
}

function getLetterheadImage(): string {
  if (!cachedLetterheadDataUrl) cachedLetterheadDataUrl = renderLetterheadCanvas()
  return cachedLetterheadDataUrl
}

// Draws the letterhead image + a title/date row at the top of a jsPDF doc.
// Returns the y-coordinate (mm) where body content should start.
export function drawLetterheadHeader(doc: any, title: string): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const imgX = (pageWidth - LETTERHEAD_IMG_WIDTH) / 2
  doc.addImage(getLetterheadImage(), 'PNG', imgX, 8, LETTERHEAD_IMG_WIDTH, LETTERHEAD_IMG_HEIGHT)

  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 14, LETTERHEAD_TITLE_Y)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120)
  doc.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth - 14, LETTERHEAD_TITLE_Y, { align: 'right' })
  doc.setTextColor(0)

  return LETTERHEAD_CONTENT_START_Y
}

// Draws the letterhead's footer contact info near the bottom of the current page.
export function drawLetterheadFooter(doc: any) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const y = pageHeight - 16
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120)
  doc.text(LETTERHEAD_FOOTER_LINE1, pageWidth / 2, y, { align: 'center' })
  doc.text(LETTERHEAD_FOOTER_LINE2, pageWidth / 2, y + 5, { align: 'center' })
  doc.setTextColor(0)
}

// Spread into any jspdf-autotable call so the letterhead header+footer
// repeat on every page that table spans — including continuation pages
// autoTable creates on its own when content overflows a page, which
// otherwise get neither (autoTable has no idea the letterhead exists).
// `didDrawPage` fires once per page a table touches, so on a document
// with several tables this may redraw the header/footer more than once
// per page — harmless, since it's the same image at the same coordinates
// each time.
export function letterheadTableOptions(doc: any, title: string, sideMargins: { left: number; right: number }) {
  return {
    margin: { top: LETTERHEAD_CONTENT_START_Y, bottom: LETTERHEAD_FOOTER_RESERVED_HEIGHT, ...sideMargins },
    didDrawPage: () => {
      drawLetterheadHeader(doc, title)
      drawLetterheadFooter(doc)
    },
  }
}
