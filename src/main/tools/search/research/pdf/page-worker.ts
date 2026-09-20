import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { createCanvas } from '@napi-rs/canvas'
import { createWorker, OEM } from 'tesseract.js'
import type { PdfInspectionRequest, PdfPageEvidence } from '../../../../../shared/pdf-evidence.js'
import { loadPdf } from './document.js'

if (!parentPort) throw new Error('PDF inspection requires a parent port')
const port = parentPort
const TEXT_LIMIT = 120_000
const ITEM_LIMIT = 5_000

async function inspect(): Promise<PdfPageEvidence> {
  const request = workerData.request as PdfInspectionRequest
  const { loading, documentSha256 } = await loadPdf(workerData.path, workerData.documentSha256)
  try {
    const document = await loading.promise
    if (request.page > document.numPages) throw new Error(`Page must be between 1 and ${document.numPages}`)
    const page = await document.getPage(request.page)
    try {
      const base = page.getViewport({ scale: 1 })
      const crop = request.crop ?? { x: 0, y: 0, width: 1, height: 1 }
      if (![base.width, base.height].every((n) => Number.isFinite(n) && n > 0 && n <= 1_000_000)) {
        throw new Error('PDF page dimensions are unsupported')
      }
      const scale = Math.min(request.dpi / 72, 2400 / (base.width * crop.width), 2400 / (base.height * crop.height))
      const viewport = page.getViewport({ scale })
      const width = Math.max(1, Math.ceil(viewport.width * crop.width))
      const height = Math.max(1, Math.ceil(viewport.height * crop.height))
      const canvas = createCanvas(width, height)
      try {
        // PDF.js can settle a render after an operator-stream error. An empty list is
        // ambiguous, so never publish it as evidence of a definitely blank source page.
        const operators = await page.getOperatorList()
        const renderIncomplete = operators.fnArray.length === 0
        await page.render({
          canvas: null, canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
          viewport, transform: [1, 0, 0, 1, -viewport.width * crop.x, -viewport.height * crop.y],
          background: 'white'
        }).promise
        const content = await page.getTextContent()
        const items = content.items.filter((item) => 'str' in item)
        const text = items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim()
        const result: PdfPageEvidence = {
          documentSha256, page: request.page, totalPages: document.numPages, width, height,
          requestedDpi: request.dpi, effectiveDpi: scale * 72, crop, pageTransform: base.transform, renderIncomplete,
          native: {
            text: text.slice(0, TEXT_LIMIT), scope: 'whole_page',
            items: items.slice(0, ITEM_LIMIT).map((item) => ({ text: item.str.slice(0, 1000), transform: item.transform, width: item.width, height: item.height })),
            incomplete: text.length > TEXT_LIMIT || items.length > ITEM_LIMIT || items.some((item) => item.str.length > 1000)
          }
        }
        if (request.action === 'page') result.image = `data:image/jpeg;base64,${canvas.toBuffer('image/jpeg', 90).toString('base64')}`
        else {
          // The bundled model is read from disk. Disable the cache and all model downloads.
          const language = createRequire(import.meta.url)('@tesseract.js-data/eng') as { langPath: string; gzip: boolean }
          const worker = await createWorker('eng', OEM.LSTM_ONLY, {
            langPath: language.langPath, gzip: language.gzip, cacheMethod: 'none', errorHandler: () => {}
          })
          try {
            await worker.setParameters({ user_defined_dpi: String(Math.round(result.effectiveDpi)) })
            const { data } = await worker.recognize(canvas.toBuffer('image/png'), {}, { text: true, blocks: true })
            const words = data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))) ?? []
            result.ocr = {
              text: data.text.slice(0, TEXT_LIMIT), confidence: data.confidence,
              words: words.slice(0, ITEM_LIMIT).map((word) => ({ text: word.text.slice(0, 1000), confidence: word.confidence, bbox: word.bbox })),
              incomplete: renderIncomplete || !data.text.trim() || data.text.length > TEXT_LIMIT || words.length > ITEM_LIMIT || words.some((word) => word.text.length > 1000),
              engine: `tesseract.js 7.0.0 / ${data.version}`, language: 'eng', coordinateSpace: 'rendered_crop_pixels'
            }
          } finally { await worker.terminate() }
        }
        return result
      } finally { canvas.width = 1; canvas.height = 1 }
    } finally { page.cleanup() }
  } finally { await loading.destroy() }
}

try { port.postMessage({ result: await inspect() }) }
catch (error) { port.postMessage({ error: `PDF inspection failed: ${error instanceof Error ? error.message : String(error)}` }) }
finally { port.close() }
