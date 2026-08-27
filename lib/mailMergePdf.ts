import mammoth from 'mammoth'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { LETTERHEAD_FOOTER_LINE1, LETTERHEAD_FOOTER_LINE2 } from './letterhead'

// docx -> PDF for the mail-merge feature, with the CRM's letterhead stamped
// on every page via Puppeteer's native header/footer templates (no per-page
// redraw hack needed here, unlike lib/letterhead.ts's jsPDF version — Chrome
// renders these once and repeats them itself).
//
// Written as real HTML/CSS, not a rasterized image — Chromium renders
// Hebrew natively, so (unlike jsPDF, which needed the canvas workaround in
// lib/letterhead.ts) there's no glyph-support problem to work around here.
//
// `letterheadKey` is accepted but currently always resolves to the one CRM
// letterhead below — a deliberate seam, not a full implementation. Selecting
// a different letterhead per template is a real feature to build later, not
// speculative unused schema now; this parameter just means that addition
// won't require changing every call site when it happens.
export type LetterheadKey = 'default'

function letterheadHeaderHtml(): string {
  return `
    <div style="font-size: 8px; width: 100%; padding: 0 0.6in; font-family: Arial, sans-serif;">
      <div style="text-align: center; font-weight: bold; font-size: 15px;">ישיבה נתיב התלמוד</div>
      <div style="text-align: center; font-size: 9px; margin-top: 2px;">1011 Cross St. &#8226; Lakewood NJ 08701</div>
      <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="text-align: left; font-weight: bold;">
          <div>הרב משה ריידעל</div>
          <div>ראש הישיבה</div>
        </div>
        <div dir="rtl" style="font-weight: bold;">בס"ד</div>
      </div>
    </div>
  `
}

function letterheadFooterHtml(): string {
  return `
    <div style="font-size: 7px; width: 100%; text-align: center; color: #666; font-family: Arial, sans-serif; padding: 0 0.6in;">
      <div>${LETTERHEAD_FOOTER_LINE1}</div>
      <div>${LETTERHEAD_FOOTER_LINE2}</div>
    </div>
  `
}

// A fresh Chromium launch per document (each one a couple hundred ms-plus)
// doesn't scale to a batch job — a 30-recipient mail merge could easily
// blow past a serverless function's execution time limit. Callers doing
// more than one conversion in a request should launch once with
// launchBrowser() and pass it to convertDocxToPdf, then close it themselves
// when done with the whole batch.
export async function launchBrowser() {
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  })
}

export async function convertDocxToPdf(
  docxBuffer: Buffer,
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  opts: { letterhead?: LetterheadKey | false } = {}
): Promise<Buffer> {
  const { value: html } = await mammoth.convertToHtml({ buffer: docxBuffer })
  const withLetterhead = opts.letterhead !== false

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.4; padding: 0 20px; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #999; padding: 4px 8px; }
  </style></head><body>${html}</body></html>`

  const page = await browser.newPage()
  try {
    await page.setContent(fullHtml, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'letter',
      margin: withLetterhead
        ? { top: '1.3in', bottom: '0.6in', left: '0.75in', right: '0.75in' }
        : { top: '0.75in', bottom: '0.75in', left: '0.75in', right: '0.75in' },
      displayHeaderFooter: withLetterhead,
      headerTemplate: withLetterhead ? letterheadHeaderHtml() : '<div></div>',
      footerTemplate: withLetterhead ? letterheadFooterHtml() : '<div></div>',
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}
