import { createHash } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { PdfInspectionRequest, PdfPageEvidence } from '../../../../../shared/pdf-evidence.js'
import { RequestBudget } from '../../request-budget.js'
import { pdfWorkerTask } from './worker-task.js'

export type PdfInspector = (path: string, documentSha256: string, request: PdfInspectionRequest, signal: AbortSignal) => Promise<PdfPageEvidence>

export function validatePdfInspection(request: PdfInspectionRequest): void {
  if (!['page', 'ocr'].includes(request.action)) throw new Error('Unknown PDF inspection action')
  if (!Number.isSafeInteger(request.page) || request.page < 1) throw new Error('PDF page must be a positive integer')
  if (!Number.isFinite(request.dpi) || request.dpi < 72 || request.dpi > 216) throw new Error('PDF dpi must be between 72 and 216')
  const crop = request.crop
  if (crop && (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
      crop.x < 0 || crop.y < 0 || crop.width < 0.01 || crop.height < 0.01 ||
      crop.x + crop.width > 1 || crop.y + crop.height > 1)) {
    throw new Error('PDF crop must fit the page; x/y are fractions from 0, width/height are fractions of at least 0.01')
  }
}

/** One expensive page operation at a time, off the Electron main thread; OCR caches are revision-specific. */
export function createPdfInspector(workerUrl: URL): PdfInspector {
  const budget = new RequestBudget(1)
  return async (path, documentSha256, request, signal) => {
    validatePdfInspection(request)
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)])
    return budget.run('pdf-page', path, deadline, async () => {
      const key = createHash('sha256').update(JSON.stringify({ version: 1, documentSha256, request })).digest('hex')
      const cache = `${path}.ocr-${key}.json`
      if (request.action === 'ocr') {
        try {
          const value = JSON.parse(await readFile(cache, 'utf8')) as PdfPageEvidence
          deadline.throwIfAborted()
          if (value.documentSha256 === documentSha256 && value.ocr) return value
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      const result = await pdfWorkerTask<PdfPageEvidence>(workerUrl, { path, documentSha256, request }, deadline)
      deadline.throwIfAborted()
      if (request.action === 'ocr') {
        try {
          await writeFile(`${cache}.tmp`, JSON.stringify(result))
          deadline.throwIfAborted()
          await rename(`${cache}.tmp`, cache)
        } finally { await rm(`${cache}.tmp`, { force: true }) }
      }
      return result
    })
  }
}
