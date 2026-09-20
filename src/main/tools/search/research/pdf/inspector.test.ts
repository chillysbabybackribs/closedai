import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadImage } from '@napi-rs/canvas'
import { createPdfInspector, validatePdfInspection } from './inspector.js'
import { createPdfReader } from './reader.js'
import { pdfFixture } from './fixtures.test-helpers.js'
import { SourceStore } from '../source-reader.js'

const signal = new AbortController().signal
const inspect = createPdfInspector(new URL('./page-worker.ts', import.meta.url))
const reader = createPdfReader(new URL('./pdf-worker.ts', import.meta.url))

test('real rendering preserves native geometry, handles rotation/crops, and checks retained byte identity', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-page-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'test.pdf')
  const bytes = pdfFixture([{ text: 'NATIVE EVIDENCE 1234' }, { text: 'ROTATED', rotate: 90 }])
  await writeFile(path, bytes)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const page = await inspect(path, hash, { action: 'page', page: 1, dpi: 216 }, signal)
  assert.equal(page.width, 2400)
  assert.equal(page.height, 900)
  assert.equal(page.documentSha256, hash)
  assert.match(page.native.text, /NATIVE EVIDENCE 1234/)
  assert.equal(page.native.items[0].transform.length, 6)
  const decoded = await loadImage(Buffer.from(page.image!.split(',')[1], 'base64'))
  assert.equal(decoded.width, page.width)
  const rotated = await inspect(path, hash, { action: 'page', page: 2, dpi: 144 }, signal)
  assert.equal(rotated.width, 600)
  assert.equal(rotated.height, 1600)
  const cropped = await inspect(path, hash, { action: 'page', page: 1, dpi: 144, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } }, signal)
  assert.equal(cropped.width, 800)
  assert.equal(cropped.native.scope, 'whole_page')
  await assert.rejects(inspect(path, '0'.repeat(64), { action: 'page', page: 1, dpi: 144 }, signal), /do not match/)
  await assert.rejects(inspect(path, hash, { action: 'page', page: 3, dpi: 144 }, signal), /between 1 and 2/)
})

test('local OCR reads an actual raster-only PDF, remains separate from native text, and caches by revision/settings', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-ocr-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bytes = pdfFixture([{ scan: 'SCANNED EVIDENCE 4827' }, { text: 'NATIVE LABEL', scan: 'SCANNED VALUE 9361' }, {}])
  const store = new SourceStore(root, async () => new Response(bytes, { headers: { 'content-type': 'application/pdf' } }), reader)
  const source = await store.collect('https://example.com/scan.pdf', 'run', 'source', signal)
  const path = await store.pdfPath('run', 'source')
  assert.equal(source.pdf?.pagesWithoutText, 2)
  assert.doesNotMatch(source.text, /SCANNED/)
  const request = { action: 'ocr' as const, page: 1, dpi: 216 }
  const page = await inspect(path, source.pdf!.documentSha256!, request, signal)
  assert.equal(page.native.text, '')
  assert.match(page.ocr!.text, /SCANNED EVIDENCE 4827/)
  assert.equal(page.ocr!.language, 'eng')
  assert.equal(page.ocr!.coordinateSpace, 'rendered_crop_pixels')
  assert.ok(page.ocr!.words.length > 0)
  assert.ok(page.ocr!.confidence > 0)
  assert.equal(page.image, undefined)
  // A missing worker proves this request is fulfilled by the retained OCR, not recomputation.
  const cacheOnly = createPdfInspector(new URL('./missing-worker.js', import.meta.url))
  assert.deepEqual(await cacheOnly(path, source.pdf!.documentSha256!, request, signal), page)
  const mixed = await inspect(path, source.pdf!.documentSha256!, { ...request, page: 2 }, signal)
  assert.match(mixed.native.text, /NATIVE LABEL/)
  assert.match(mixed.ocr!.text, /SCANNED VALUE 9361/)
  assert.equal(await store.read('run', 'source'), source.text)
  const empty = await inspect(path, source.pdf!.documentSha256!, { ...request, page: 3 }, signal)
  assert.equal(empty.ocr!.text.trim(), '')
  assert.equal(empty.ocr!.incomplete, true)
  assert.equal((await readdir(join(root, 'run'))).filter((name) => name.endsWith('.json')).length, 3)
})

test('inspection validates page/crop budgets before starting work', () => {
  for (const request of [
    { page: 0, dpi: 144 }, { page: 1, dpi: Infinity }, { page: 1, dpi: 217 },
    { page: 1, dpi: 144, crop: { x: 0.9, y: 0, width: 0.2, height: 1 } }
  ]) assert.throws(() => validatePdfInspection({ action: 'page', ...request }))
})

test('an oversized embedded raster cannot masquerade as a definitely blank page', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-large-raster-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bytes = pdfFixture([{ scan: 'OVERSIZE', imageWidth: 80_000 }])
  const path = join(root, 'large.pdf')
  await writeFile(path, bytes)
  const page = await inspect(path, createHash('sha256').update(bytes).digest('hex'), { action: 'page', page: 1, dpi: 72 }, signal)
  assert.equal(page.renderIncomplete, true)
})

test('cancellation terminates nested workers and releases the inspection queue', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-child-abort-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workerUrl = pathToFileURL(join(root, 'nested.mjs'))
  await writeFile(workerUrl, `import { Worker, workerData } from 'node:worker_threads';
    new Worker('const {workerData}=require("node:worker_threads"); const fs=require("node:fs"); setInterval(()=>fs.appendFileSync(workerData,"x"),10)', {eval:true,workerData:workerData.path});`)
  const nested = createPdfInspector(workerUrl)
  for (let i = 0; i < 2; i++) {
    const controller = new AbortController()
    const marker = join(root, `marker-${i}`)
    const promise = nested(marker, 'hash', { action: 'page', page: 1, dpi: 144 }, controller.signal)
    const rejected = assert.rejects(promise, /cancel nested/)
    try {
      const until = Date.now() + 5000
      while (!(await readFile(marker, 'utf8').catch(() => ''))) {
        assert.ok(Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    } finally { controller.abort(new Error('cancel nested')); await rejected }
    const stopped = await readFile(marker, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await readFile(marker, 'utf8'), stopped)
  }
})
