import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { cdpTools } from './index.js'
import type { CdpToolHost } from './host.js'
import type { BrowserToolHost } from '../browser/host.js'

type Row = { url: string; requestId: string; type?: string }

function capture(rows: Row[], bodies: Record<string, string>) {
  const reads: string[] = []
  const host = {
    networkRequests: async () => ({ capturing: true, requests: rows.map((row) => ({ method: 'POST', sessionId: null, status: 200, ...row })) }),
    responseBody: async (_tabId: string, requestId: string) => {
      reads.push(requestId)
      return { requestId, text: bodies[requestId], base64Encoded: false }
    }
  } as unknown as CdpToolHost
  const page = {
    navigate: async (url: string) => ({ ok: true as const, tabId: 'tab-1', ready: { url, title: 'Loaded', loadState: 'complete' as const, timedOut: false } })
  } as unknown as BrowserToolHost
  const registry = new ToolRegistry([cdpTools(() => host, undefined, () => page)])
  const call = async (args: Record<string, unknown>) => {
    const result = await registry.call({ namespace: 'browser_cdp', tool: 'capture_spa', arguments: { url: 'https://hn.test/?q=x', ...args } }, { threadId: null, turnId: null, callId: 'spa' })
    const text = result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
    return { result, text, body: result.isError ? {} : JSON.parse(text) as Record<string, unknown> }
  }
  return { call, reads }
}

const hits = Array.from({ length: 20 }, (_, index) => ({
  title: `Story ${index}`,
  url: `https://example.test/${index}`,
  points: index,
  story_text: 'x'.repeat(400),
  _highlightResult: { title: { value: `<em>Story</em> ${index}`, matchedWords: ['story'] } },
  _tags: ['story', `author_${index}`]
}))

test('capture_spa skips newer non-JSON matches and reports how many it passed over', async () => {
  const { call, reads } = capture([
    { url: 'https://api.algolia.test/1/indexes/Item/query', requestId: 'query' },
    { url: 'https://insights.algolia.test/1/events', requestId: 'beacon' },
    { url: 'https://cdn.algolia.test/client.js', requestId: 'script' }
  ], { query: '{"hits":[{"title":"A"}]}', beacon: 'OK', script: 'function x(){}' })
  const { result, body } = await call({ url_contains: 'algolia', json_path: 'hits', fields: ['title'] })
  assert.equal(result.isError, undefined)
  assert.deepEqual(body.json, [{ title: 'A' }])
  assert.equal(body.skippedNonJson, 2)
  assert.deepEqual(reads, ['script', 'beacon', 'query'])
})

test('capture_spa names the checked URLs when no matching body is JSON', async () => {
  const { call } = capture([{ url: 'https://cdn.algolia.test/client.js', requestId: 'script' }], { script: 'function x(){}' })
  const { result, text } = await call({ url_contains: 'algolia' })
  assert.equal(result.isError, true)
  assert.match(text, /None of the 1 newest matching requests returned a JSON body/)
  assert.match(text, /client\.js/)
})

test('capture_spa previews a large unprojected body within an inline-sized result', async () => {
  const { call } = capture([{ url: 'https://api.algolia.test/1/indexes/Item/query', requestId: 'query' }], {
    query: JSON.stringify({ hits, nbHits: 20, page: 0, params: 'query=x' })
  })
  const { result, text, body } = await call({ url_contains: 'Item/query' })
  assert.equal(result.isError, undefined)
  assert.ok(text.length < 4000, `preview stays inline-sized (${text.length})`)
  assert.equal('json' in body, false)
  assert.deepEqual(body.shape, { hits: 'array(20)', nbHits: 'number', page: 'number', params: 'string' })
  const preview = body.preview as { json_path: string; count: number; items: Array<Record<string, unknown>> }
  assert.equal(preview.json_path, 'hits')
  assert.equal(preview.count, 20)
  assert.deepEqual(preview.items.map((item) => item.title), ['Story 0', 'Story 1', 'Story 2'])
  assert.equal('_highlightResult' in preview.items[0], false)
  assert.ok(String(preview.items[0].story_text).length <= 161)
})

test('capture_spa returns a small unprojected body whole', async () => {
  const { call } = capture([{ url: 'https://api.test/q', requestId: 'q' }], { q: '{"ok":true}' })
  const { body } = await call({ url_contains: '/q' })
  assert.deepEqual(body.json, { ok: true })
  assert.equal('preview' in body, false)
})
