import assert from 'node:assert/strict'
import test from 'node:test'
import type { PdfPageEvidence } from '../../../../../shared/pdf-evidence.js'
import type { ToolContext } from '../../../tool.js'
import { ResearchService, type ResearchDependencies } from '../service.js'
import { SearchRouter } from '../../router.js'

const context: ToolContext = { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal }
const evidence: PdfPageEvidence = {
  documentSha256: 'hash', page: 1, totalPages: 1, width: 800, height: 300, requestedDpi: 72, effectiveDpi: 72,
  crop: { x: 0, y: 0, width: 1, height: 1 }, pageTransform: [1, 0, 0, -1, 0, 300], renderIncomplete: false,
  native: { text: 'native evidence', items: [], incomplete: false, scope: 'whole_page' }, image: 'data:image/jpeg;base64,anBn',
  ocr: { text: 'recognized evidence', words: [], confidence: 95, incomplete: false, engine: 'fixture', language: 'eng', coordinateSpace: 'rendered_crop_pixels' }
}

async function harness(inspectPdf: NonNullable<ResearchDependencies['inspectPdf']>) {
  const service = new ResearchService(new SearchRouter([]), {
    owner: (caller) => ({ paneId: caller.paneId!, threadId: caller.threadId!, turnId: caller.turnId, workspace: '/test' }),
    collect: async () => ({ url: 'https://example.com/test.pdf', title: 'PDF', text: 'native evidence', contentType: 'application/pdf',
      sha256: 'text-hash', representation: 'pdf_text', incomplete: false,
      pdf: { totalPages: 1, extractedPages: 1, pagesWithoutText: 0, documentSha256: 'hash' } }),
    read: async () => 'native evidence', remove: async () => {}, replace: async () => {}, discard: async () => {}, inspectPdf
  })
  let run = service.start({ queries: [], urls: ['https://example.com/test.pdf'], maxSources: 1, deadlineMs: 1000, presentation: 'background' }, context)
  while (run.state === 'running') run = await service.wait(run.runId, context, run.cursor, 1000)
  run = service.read(run.runId, context)
  return { service, id: run.runId, source: run.sources[0].id }
}

test('PDF inspection returns page images and OCR text; invalid inputs are rejected', async (t) => {
  const calls: unknown[] = []
  const h = await harness(async (_run, _source, hash, request) => {
    calls.push(request)
    assert.equal(hash, 'hash')
    return request.action === 'page' ? { ...evidence, ocr: undefined } : { ...evidence, image: undefined }
  })
  t.after(() => h.service.dispose())
  const page = await h.service.inspectPdf(h.id, h.source, context, { action: 'page', page: 1, dpi: 144 })
  assert.equal(page.image, evidence.image)
  assert.equal(page.native.text, 'native evidence')
  const ocr = await h.service.inspectPdf(h.id, h.source, context, { action: 'ocr', page: 1, dpi: 216 })
  assert.equal(ocr.ocr?.text, 'recognized evidence')
  assert.equal(ocr.ocr?.confidence, 95)
  await assert.rejects(h.service.inspectPdf(h.id, h.source, context, { action: 'page', page: 0, dpi: 144 }), /Page must be between 1/)
  await assert.rejects(h.service.inspectPdf(h.id, h.source, context, { action: 'ocr', page: 1, dpi: 217 }), /between 72 and 216/)
  assert.equal(calls.length, 2)
})

test('inspection respects ownership, serializes against expansion, and releases the lease on failure', async (t) => {
  let reject!: (error: Error) => void
  const h = await harness(async () => new Promise((_resolve, fail) => { reject = fail }))
  t.after(() => h.service.dispose())
  const request = { action: 'page' as const, page: 1, dpi: 144 }
  await assert.rejects(h.service.inspectPdf(h.id, h.source, { ...context, paneId: 'other' }, request), /unavailable/)
  const pending = h.service.inspectPdf(h.id, h.source, context, request)
  const failure = assert.rejects(pending, /worker failure/)
  assert.equal(h.service.read(h.id, context).pending, 1)
  await assert.rejects(h.service.expand(h.id, h.source, context, {}), /inspection in progress/)
  await assert.rejects(h.service.inspectPdf(h.id, h.source, context, request), /inspection in progress/)
  reject(new Error('worker failure'))
  await failure
  assert.equal(h.service.read(h.id, context).pending, 0)
  assert.equal(h.service.read(h.id, context).sources[0].sha256, 'text-hash')
})

test('long native items fit the result budget with an accurate continuation cursor', async (t) => {
  const h = await harness(async () => ({ ...evidence, ocr: undefined, native: {
    ...evidence.native, text: 't'.repeat(12_000), items: Array.from({ length: 30 }, () => ({ text: 'x'.repeat(1000), transform: [1, 0, 0, 1, 0, 0], width: 100, height: 12 }))
  } }))
  t.after(() => h.service.dispose())
  const result = await pdfTool(h.service).run({ action: 'page', run_id: h.id, source_id: h.source, page: 1, max_chars: 6000, max_items: 30 }, context)
  const text = result.content[0].type === 'text' ? result.content[0].text.split('\n')[0] : ''
  const body = JSON.parse(text)
  assert.ok(text.length <= 14_000)
  assert.ok(body.items.length > 0 && body.items.length < 30)
  assert.equal(body.nextItemsOffset, body.items.length)
  assert.equal(body.nextOffset, 6000)
})

test('cancel, turn replacement and shutdown abort active PDF inspection', async () => {
  for (const action of ['cancel', 'reconcile', 'dispose'] as const) {
    let activeSignal!: AbortSignal
    const h = await harness(async (_run, _source, _hash, _request, signal) => {
      activeSignal = signal
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    const pending = h.service.inspectPdf(h.id, h.source, context, { action: 'ocr', page: 1, dpi: 144 })
    const rejected = assert.rejects(pending)
    if (action === 'cancel') h.service.cancel(h.id, context)
    else if (action === 'reconcile') h.service.reconcile('pane', 'thread', 'next-turn')
    else h.service.dispose()
    await rejected
    assert.equal(activeSignal.aborted, true)
    assert.equal(h.service.read(h.id, context).pending, 0)
    h.service.dispose()
  }
})
