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
  const unsupported = new SourceStore(root, async () => new Response('pdf', { headers: { 'content-type': 'application/pdf' } }))
  await assert.rejects(unsupported.collect('https://example.com', 'run', 'pdf', new AbortController().signal), /Unsupported source/)
})
