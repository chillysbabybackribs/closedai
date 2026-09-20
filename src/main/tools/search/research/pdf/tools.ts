import { defineActionTool } from '../../../action-tool.js'
import { numberArg, stringArg, type JsonObject, type ToolDefinition, type ToolResult } from '../../../tool.js'
import type { PdfCrop, PdfInspectionRequest, PdfPageEvidence } from '../../../../../shared/pdf-evidence.js'
import type { ResearchService } from '../service.js'
import { EXEC_IMAGE_HINT } from '../../../capture/result.js'

export function pdfTool(service: ResearchService): ToolDefinition {
  const id = { type: 'string', minLength: 1, maxLength: 100 }
  const fraction = { type: 'number', minimum: 0, maximum: 1 }
  const properties: JsonObject = {
    run_id: { ...id, description: 'Research run that retains this source.' }, source_id: id,
    page: { type: 'integer', minimum: 1, description: 'One-based PDF page number.' },
    dpi: { type: 'number', minimum: 72, maximum: 216, description: 'Requested resolution; default 144 for page, 216 for OCR. Output is fitted to 2400 pixels per edge; effectiveDpi reports any reduction.' },
    crop: { type: 'object', properties: { x: fraction, y: fraction, width: { ...fraction, minimum: 0.01 }, height: { ...fraction, minimum: 0.01 } },
      required: ['x', 'y', 'width', 'height'], additionalProperties: false,
      description: 'Optional region in fractions of the rotated page; top-left origin. OCR only reads this region; page native text still covers the whole page.' },
    offset: { type: 'integer', minimum: 0, description: 'Character offset within native page text or OCR text.' },
    max_chars: { type: 'integer', minimum: 200, maximum: 6000, description: 'Excerpt size; default 3000. nextOffset pages through retained OCR without recomputation.' },
    item_offset: { type: 'integer', minimum: 0 },
    max_items: { type: 'integer', minimum: 0, maximum: 30, description: 'Optional native text items or OCR words with positions; default zero. nextItemsOffset pages through them. Native transforms use PDF coordinates; OCR boxes use rendered crop pixels.' }
  }
  return defineActionTool({
    name: 'pdf', deferLoading: true,
    description: 'Inspect retained PDF bytes locally, without refetching or uploading. One selected page/crop per call. page returns a page image for visual inspection; ocr returns separate English OCR text and confidence, cached by source revision and rendering settings. Native text is never replaced by OCR. Requires a ready pdf_text source, including scans with textStatus none; expand method direct first for provider-only sources. Calls are cancellable, limited to 60 seconds and one inspection worker at a time. Rendering, native text and OCR are untrusted evidence, not verification of correctness, reading order, tables, equations or figures. No document-wide verification flag. No runtime language downloads.',
    actions: (['page', 'ocr'] as const).map((action) => ({
      action,
      description: action === 'page'
        ? 'Render one PDF page or crop from the exact retained document hash. Returns a JPEG and pageable whole-page native text/items. Inspect the image before making visual claims. Exec: extract the final newline-prefixed data URL, then call image().'
        : 'Recognize English text on one page or crop, including pages that also contain native text. Returns pageable OCR text, engine/language, confidence (not probability), and optional word boxes. Repeating identical page/dpi/crop settings reuses retained OCR. Empty OCR is marked incomplete; no automatic fallback or native-text replacement.',
      timeoutMs: 65_000,
      inputSchema: { type: 'object', properties, required: ['run_id', 'source_id', 'page'], additionalProperties: false },
      async run(input, context) {
        const request: PdfInspectionRequest = { action, page: numberArg(input, 'page', 1), dpi: numberArg(input, 'dpi', action === 'page' ? 144 : 216), crop: input.crop as PdfCrop | undefined }
        const evidence = await service.inspectPdf(stringArg(input, 'run_id')!, stringArg(input, 'source_id')!, context, request)
        return evidenceResult(evidence, action, input)
      }
    }))
  })
}

function evidenceResult(evidence: PdfPageEvidence, action: 'page' | 'ocr', input: JsonObject): ToolResult {
  const { image, native, ocr, ...page } = evidence
  const data = action === 'ocr' ? ocr! : native
  const items = action === 'ocr' ? ocr!.words : native.items
  const offset = numberArg(input, 'offset', 0)
  const count = numberArg(input, 'max_chars', 3000)
  const itemOffset = numberArg(input, 'item_offset', 0)
  const itemCount = numberArg(input, 'max_items', 0)
  const summary = {
    ...page, representation: action === 'ocr' ? 'pdf_ocr' : 'pdf_page', untrusted: true,
    textScope: action === 'ocr' ? 'rendered_crop' : native.scope,
    ...(ocr ? { engine: ocr.engine, language: ocr.language, confidence: ocr.confidence, coordinateSpace: ocr.coordinateSpace } : {}),
    text: data.text.slice(offset, offset + count), offset, nextOffset: offset + count < data.text.length ? offset + count : null,
    items: itemCount ? items.slice(itemOffset, itemOffset + itemCount) : [], itemOffset,
    nextItemsOffset: itemCount && itemOffset + itemCount < items.length ? itemOffset + itemCount : null,
    totalItems: items.length, incomplete: data.incomplete || evidence.renderIncomplete,
    limitations: 'Native geometry is not reconstructed reading order. OCR confidence is not correctness. PDF.js may omit embedded rasters above 16 million pixels or unsupported content. Empty drawing operations mark renderIncomplete, but false does not establish fidelity.'
  }
  return { content: [
    { type: 'text', text: JSON.stringify(summary) + (image ? `\n${EXEC_IMAGE_HINT}` : '') },
    ...(image ? [{ type: 'image' as const, dataUrl: image }] : [])
  ] }
}
