import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceStore, documentText, publicUrl } from './source-reader.js'

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

test('collector follows explicit redirects, omits credentials, and retains hashed bounded text', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'research-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls: string[] = []
  const store = new SourceStore(root, async (url, init) => {
    calls.push(String(url))
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.redirect, 'manual')
    return calls.length === 1
      ? new Response('', { status: 302, headers: { location: '/final' } })
      : new Response('<title>Final</title><main>Evidence &amp; facts</main>', { headers: { 'content-type': 'text/html' } })
  })
  const doc = await store.collect('https://example.com/start', 'run', 'source', new AbortController().signal)
  assert.deepEqual(calls, ['https://example.com/start', 'https://example.com/final'])
  assert.equal(doc.url, 'https://example.com/final')
  assert.equal(doc.text, 'Evidence & facts')
  assert.equal(doc.sha256.length, 64)
  assert.equal(await store.read('run', 'source'), doc.text)
  assert.deepEqual((await readdir(join(root, 'run'))).sort(), ['source.raw', 'source.txt'])
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
