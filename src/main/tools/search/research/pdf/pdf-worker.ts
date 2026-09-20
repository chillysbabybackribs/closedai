import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfText } from './reader.js'

if (!parentPort) throw new Error('PDF parser requires a parent port')
const port = parentPort

async function extract(): Promise<PdfText> {
  const assets = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const loading = getDocument({
    data: new Uint8Array(await readFile(workerData.path)),
    useWorkerFetch: false, disableFontFace: true, useSystemFonts: false,
    enableXfa: false, stopAtErrors: true, verbosity: VerbosityLevel.ERRORS,
    cMapUrl: join(assets, 'cmaps') + sep, standardFontDataUrl: join(assets, 'standard_fonts') + sep
  })
  try {
    const document = await loading.promise
    const metadata = await document.getMetadata()
    const title = (metadata.info as { Title?: unknown }).Title
    const result: PdfText = {
      text: '', title: typeof title === 'string' ? title.slice(0, 180) : '', incomplete: false,
      pdf: { totalPages: document.numPages, extractedPages: 0, pagesWithoutText: 0 }
    }
    let hasText = false
    const limit = workerData.maxTextChars as number
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      try {
        const content = await page.getTextContent()
        const text = content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
        if (text) hasText = true
        else result.pdf.pagesWithoutText++
        const section = `${number === 1 ? '' : '\n\n'}[Page ${number}]\n${text}`
        const remaining = limit === 0 ? section.length : Math.max(0, limit - result.text.length)
        result.text += section.slice(0, remaining)
        result.pdf.extractedPages++
        if (section.length > remaining || (limit > 0 && result.text.length >= limit && number < document.numPages)) {
          result.incomplete = true
          break
        }
      } finally { page.cleanup() }
    }
    if (!hasText) throw new Error('PDF has no extractable text in the inspected pages; scanned/image-only PDFs require OCR, which is unavailable')
    result.incomplete ||= result.pdf.pagesWithoutText > 0
    return result
  } finally { await loading.destroy() }
}

try { port.postMessage({ result: await extract() }) }
catch (error) {
  const message = error instanceof Error && error.name === 'PasswordException'
    ? 'PDF requires a password; encrypted document text is unavailable'
    : `PDF text extraction failed: ${error instanceof Error ? error.message : String(error)}`
  port.postMessage({ error: message })
} finally { port.close() }
