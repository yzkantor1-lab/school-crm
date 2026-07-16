/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF's document type is `any` upstream (see lib/tuitionPdf.ts for the same note). */

// Opens a blank tab synchronously, before any `await`, so the browser still
// credits the click that triggered it and doesn't treat the later navigation
// as an unrequested popup.
export function openPreviewTab(): Window | null {
  if (typeof window === 'undefined') return null
  return window.open('', '_blank')
}

// Points the pre-opened tab at the PDF as a blob URL, which browsers render
// inline in their built-in viewer rather than downloading — this is what lets
// the user just look at the document instead of it landing on disk every time.
export function showPdfPreview(doc: any, win: Window | null) {
  const blobUrl = doc.output('bloburl') as string
  if (win && !win.closed) win.location.href = blobUrl
  else window.open(blobUrl, '_blank')
}
