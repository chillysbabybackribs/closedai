import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SourceStore } from './source-reader.js'

test('expansion commits corresponding bytes and text; failed replacements preserve both; provider text has no stale PDF', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'source-revisions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let body = '%PDF-original'
  const store = new SourceStore(root, async () => new Response(body, { headers: { 'content-type': 'application/pdf' } }), async (path) => ({
    text: await readFile(path, 'utf8'), title: '', incomplete: false, pdf: { totalPages: 1, extractedPages: 1, pagesWithoutText: 0 }
  }))
  const signal = new AbortController().signal
  const first = await store.collect('https://example.com/paper.pdf', 'run', 'source', signal)
  const originalPath = await store.pdfPath('run', 'source')
  body = '%PDF-new-revision-with-more-text'
  const second = await store.collect('https://example.com/paper.pdf', 'run', 'staged', signal)
  await store.replace('run', 'source', 'staged')
  await store.discard('run', 'staged')
  const expandedPath = await store.pdfPath('run', 'source')
  assert.notEqual(first.pdf?.documentSha256, second.pdf?.documentSha256)
  assert.notEqual(expandedPath, originalPath)
  assert.equal(await readFile(expandedPath, 'utf8'), body)
  assert.equal(await store.read('run', 'source'), body)
  // Readers already holding the prior revision remain safe until run eviction.
  assert.equal(await readFile(originalPath, 'utf8'), '%PDF-original')
  await assert.rejects(store.replace('run', 'source', 'missing'))
  assert.equal(await store.pdfPath('run', 'source'), expandedPath)
  assert.equal(await store.read('run', 'source'), body)
  await store.retain('run', 'provider', { url: 'https://example.com/paper.pdf', title: '', text: 'Provider evidence', truncated: false }, 'provider_text')
  await store.replace('run', 'source', 'provider')
  await store.discard('run', 'provider')
  assert.equal(await store.read('run', 'source'), 'Provider evidence')
  await assert.rejects(readFile(await store.pdfPath('run', 'source')), /ENOENT/)
  await store.remove('run')
  await assert.rejects(readFile(expandedPath), /ENOENT/)
})
