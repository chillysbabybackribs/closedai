import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPdfReader } from './reader.js'
import { SourceStore } from '../source-reader.js'
import { ResearchService } from '../service.js'
import { SearchRouter } from '../../router.js'

// A real, self-contained PDF with cross-reference offsets, standard font and one stream per page.
function pdf(pages: string[]): Uint8Array<ArrayBuffer> {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Title (Research fixture) >>'
  ]
  for (const text of pages) {
    const stream = text ? `BT /F1 12 Tf 50 700 Td (${text}) Tj ET` : ''
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

const reader = createPdfReader(new URL('./pdf-worker.ts', import.meta.url))
const signal = new AbortController().signal
const url = 'https://example.com/paper.pdf'

test('direct PDF read preserves bytes, page markers, metadata and hash; supports exact byte limits and generic MIME', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-read-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const body = pdf(['First page evidence', 'Second page evidence'])
  for (const [index, mime] of ['application/pdf', 'application/octet-stream', ''].entries()) {
    const store = new SourceStore(root, async () => new Response(body, { headers: { 'content-type': mime } }), reader)
    const document = await store.collect(url, 'run', String(index), signal, { maxSourceBytes: body.length })
    assert.equal(document.representation, 'pdf_text')
    assert.equal(document.title, 'Research fixture')
    assert.deepEqual(document.pdf, { totalPages: 2, extractedPages: 2, pagesWithoutText: 0 })
    assert.equal(document.incomplete, false)
    assert.match(document.text, /\[Page 1\]\nFirst page evidence\n\n\[Page 2\]\nSecond page evidence/)
    assert.equal(document.sha256.length, 64)
    assert.equal(await store.read('run', String(index)), document.text)
    assert.deepEqual(new Uint8Array(await readFile(join(root, 'run', `${index}.raw`))), body)
  }
})

test('text and download limits remain distinct; failed/truncated PDF downloads publish no text', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-limits-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const body = pdf(['First page evidence', 'Second page evidence'])
  const store = new SourceStore(root, async () => new Response(body, { headers: { 'content-type': 'application/pdf' } }), reader)
  const limited = await store.collect(url, 'run', 'limited', signal, { maxTextChars: 20 })
  assert.equal(limited.text.length, 20)
  assert.equal(limited.incomplete, true)
  assert.equal(limited.pdf?.extractedPages, 1)
  await assert.rejects(store.collect(url, 'failed', 'short', signal, { maxSourceBytes: body.length - 1 }), /exceeds max_source_bytes/)
  assert.deepEqual(await readdir(join(root, 'failed')), [])
  const full = await store.collect(url, 'run', 'expanded', signal, { maxTextChars: 0, maxSourceBytes: 0 })
  assert.equal(full.incomplete, false)
  assert.equal(full.pdf?.extractedPages, 2)
})

test('image-only/empty pages do not masquerade as extracted evidence; malformed PDFs fail cleanly', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-errors-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [index, body] of [pdf(['']), new TextEncoder().encode('%PDF-1.4\nbroken')].entries()) {
    const store = new SourceStore(root, async () => new Response(body, { headers: { 'content-type': 'application/pdf' } }), reader)
    await assert.rejects(store.collect(url, 'run', String(index), signal), index === 0 ? /require OCR/ : /PDF text extraction failed/)
  }
  assert.deepEqual(await readdir(join(root, 'run')), [])
  const store = new SourceStore(root, async () => new Response(pdf(['Evidence', '']), { headers: { 'content-type': 'application/pdf' } }), reader)
  const mixed = await store.collect(url, 'run', 'mixed', signal)
  assert.equal(mixed.incomplete, true)
  assert.equal(mixed.pdf?.pagesWithoutText, 1)
})

test('cancellation terminates a stuck parser and releases its admission slot', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-abort-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workerUrl = pathToFileURL(join(root, 'stuck.mjs'))
  await writeFile(workerUrl, `import { writeFileSync } from 'node:fs'; import { workerData } from 'node:worker_threads';
    writeFileSync(workerData.path, 'started'); while (true) {}`)
  const stuck = createPdfReader(workerUrl)
  for (let i = 0; i < 3; i++) {
    const controller = new AbortController()
    const marker = join(root, `started-${i}`)
    const pending = stuck(marker, 0, controller.signal)
    const rejected = assert.rejects(pending, /Test cancelled PDF/)
    try {
      const deadline = Date.now() + 5000
      while (!(await readFile(marker, 'utf8').catch(() => ''))) {
        assert.ok(Date.now() < deadline, 'each parser started, including after the first two cancellations')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    } finally { controller.abort(new Error('Test cancelled PDF')); await rejected }
  }
})

test('completed research can expand PDF coverage, page retained text, and preserve evidence after parser failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-expand-'))
  let body = pdf(['First page evidence', 'Second page evidence'])
  const store = new SourceStore(root, async () => new Response(body, { headers: { 'content-type': 'application/pdf' } }), reader)
  const service = new ResearchService(new SearchRouter([]), {
    owner: () => ({ paneId: 'pane', threadId: 'thread', turnId: 'turn', workspace: '/test' }),
    collect: (...args) => store.collect(...args), read: (...args) => store.read(...args),
    replace: (...args) => store.replace(...args), discard: (...args) => store.discard(...args), remove: (id) => store.remove(id)
  })
  t.after(async () => { service.dispose(); await rm(root, { recursive: true, force: true }) })
  const context = { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'test', signal }
  let run = service.start({ queries: [], urls: [url], maxSources: 1, deadlineMs: 10_000, presentation: 'background', coverage: { maxTextChars: 20 } }, context)
  while (run.state === 'running') run = await service.wait(run.runId, context, run.cursor, 1000)
  run = service.read(run.runId, context)
  const source = run.sources[0]
  assert.equal(source.representation, 'pdf_text')
  assert.equal(source.pdf?.extractedPages, 1)
  await service.expand(run.runId, source.id, context, { maxTextChars: 0 }, 'direct')
  const after = service.read(run.runId, context).sources[0]
  assert.equal(after.id, source.id)
  assert.equal(after.pdf?.extractedPages, 2)
  assert.equal(after.incomplete, false)
  const excerpt = await service.source(run.runId, source.id, context, 0, 100, 'Second page') as { text: string }
  assert.match(excerpt.text, /Second page evidence/)
  body = new TextEncoder().encode('broken')
  await assert.rejects(service.expand(run.runId, source.id, context, { maxTextChars: 0 }), /PDF text extraction failed/)
  assert.equal(service.read(run.runId, context).sources[0].sha256, after.sha256)
  assert.match(await store.read(run.runId, source.id), /Second page evidence/)
})
