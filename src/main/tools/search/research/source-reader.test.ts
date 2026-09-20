import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceNeedsRendering, SourceStore, documentText, publicUrl } from './source-reader.js'

test('HTML extraction is inert, decodes entities, excludes scripts and preserves table/code text', () => {
  const result = documentText('<title>Source &amp; title</title><nav>Menu</nav><main><h1>Title</h1><p>A &lt; B</p><script>bad()</script><div hidden>Secret</div><pre>const answer = 42</pre><table><tr><td>Revenue</td><td>123</td></tr></table></main>', 'text/html')
  assert.equal(result.title, 'Source & title')
  assert.match(result.text, /A < B/)
  assert.match(result.text, /const answer = 42/)
  assert.match(result.text, /Revenue.*123/)
  assert.doesNotMatch(result.text, /Menu|bad\(\)|Secret/)
  assert.throws(() => publicUrl('file:///etc/passwd'), /HTTP/)
  assert.throws(() => publicUrl('https://user:secret@example.com'), /credentials/)
})

test('publication, modification and transport dates retain distinct provenance; generic dates are not guessed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'research-dates-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new SourceStore(root, async () => new Response(
    '<head><meta property="article:published_time" content="2020-01-01"><meta name="dateModified" content="2026-09-20"><meta name="date" content="2030-01-01"></head><main>Evidence</main>',
    { headers: { 'content-type': 'text/html', 'last-modified': 'Sun, 20 Sep 2026 12:00:00 GMT' } }
  ))
  const doc = await store.collect('https://example.com/source', 'run', 'dates', new AbortController().signal)
  assert.deepEqual(doc.dates, [
    { kind: 'published', value: '2020-01-01', source: 'html:article:published_time' },
    { kind: 'modified', value: '2026-09-20', source: 'html:datemodified' },
    { kind: 'http_last_modified', value: 'Sun, 20 Sep 2026 12:00:00 GMT', source: 'http:Last-Modified' }
  ])
  assert.equal(documentText('<main>No dates</main>', 'text/html').dates?.length, 0)
})

test('collector lets the transport follow redirects, records the final URL, omits credentials, and retains hashed bounded text', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'research-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls: string[] = []
  const store = new SourceStore(root, async (url, init) => {
    calls.push(String(url))
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.redirect, 'follow')
    const response = new Response('<title>Final</title><main>Evidence &amp; facts</main>', { headers: { 'content-type': 'text/html' } })
    Object.defineProperty(response, 'url', { value: 'https://example.com/final' })
    return response
  })
  const doc = await store.collect('https://example.com/start', 'run', 'source', new AbortController().signal)
  assert.deepEqual(calls, ['https://example.com/start'])
  assert.equal(doc.url, 'https://example.com/final')
  assert.equal(doc.text, 'Evidence & facts')
  assert.equal(doc.representation, 'static_text')
  assert.equal(doc.sparse, undefined)
  assert.equal(doc.sha256.length, 64)
  assert.equal(await store.read('run', 'source'), doc.text)
  assert.deepEqual((await readdir(join(root, 'run'))).sort(), ['source.raw', 'source.txt'])
})

test('JavaScript shells are reported for rendering and rendered text is retained under the same id', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'research-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pages: Record<string, string> = {
    'https://app.example/empty': '<div id="root"></div><script src="/bundle.js"></script>',
    'https://app.example/sparse': '<div id="root">Loading…</div><script src="/bundle.js"></script>',
    'https://app.example/plain': '<p>Short but real.</p>'
  }
  const store = new SourceStore(root, async (url) => new Response(pages[String(url)], { headers: { 'content-type': 'text/html' } }))
  const signal = new AbortController().signal
  await assert.rejects(store.collect('https://app.example/empty', 'run', 'empty', signal), (error: Error) => error instanceof SourceNeedsRendering)
  assert.equal((await store.collect('https://app.example/sparse', 'run', 'sparse', signal)).sparse, true)
  assert.equal((await store.collect('https://app.example/plain', 'run', 'plain', signal)).sparse, undefined)
  const rendered = await store.retain('run', 'empty', { url: 'https://app.example/empty', title: 'App', text: 'Rendered evidence', truncated: false })
  assert.equal(rendered.representation, 'rendered_text')
  assert.equal(rendered.sha256.length, 64)
  assert.equal(await store.read('run', 'empty'), 'Rendered evidence')
  await assert.rejects(store.retain('run', 'blank', { url: 'https://app.example/x', title: '', text: ' \n', truncated: false }), /no readable text/)
})

test('oversized source bodies are cancelled and marked incomplete; unsupported MIME is a failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'research-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let cancelled = false
  const store = new SourceStore(root, async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new TextEncoder().encode('a'.repeat(100_000))) },
    cancel() { cancelled = true }
  }), { headers: { 'content-type': 'text/plain' } }))
  const doc = await store.collect('https://example.com', 'run', 'large', new AbortController().signal)
  assert.equal(doc.incomplete, true)
  assert.equal(doc.text.length, 120_000)
  assert.equal(cancelled, true)
  const unsupported = new SourceStore(root, async () => new Response('image', { headers: { 'content-type': 'image/png' } }))
  await assert.rejects(unsupported.collect('https://example.com', 'run', 'pdf', new AbortController().signal), /Unsupported source/)
})

test('independent text and byte budgets expand beyond old caps; staged failures preserve readable evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'research-coverage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const body = 'evidence '.repeat(100_000)
  const store = new SourceStore(root, async () => new Response(body, { headers: { 'content-type': 'text/plain' } }))
  const signal = new AbortController().signal
  const limited = await store.collect('https://example.com', 'run', 'source', signal, { maxTextChars: 200_000, maxSourceBytes: 300_000 })
  assert.equal(limited.text.length, 200_000)
  assert.equal(limited.incomplete, true)
  const expanded = await store.collect('https://example.com', 'run', 'staged', signal, { maxTextChars: 0, maxSourceBytes: 0 })
  assert.equal(expanded.text, body)
  assert.equal(expanded.incomplete, false)
  assert.equal((await store.read('run', 'source')).length, 200_000)
  await store.replace('run', 'source', 'staged')
  await store.discard('run', 'staged')
  assert.equal(await store.read('run', 'source'), body)
  await assert.rejects(store.replace('run', 'source', 'missing'))
  assert.equal(await store.read('run', 'source'), body)
  const provider = await store.retain('run', 'provider', { url: 'https://example.com', title: '', text: body, truncated: false }, 'provider_text', { maxTextChars: 0 })
  assert.equal(provider.text.length, body.length)
  assert.equal(provider.incomplete, false)
})
