import assert from 'node:assert/strict'
import test from 'node:test'
import { exaClient, exaContents, EXA_TEXT_CHARS } from './exa.js'
import type { SearchRequest } from './types.js'

const signal = new AbortController().signal
const now = () => Date.UTC(2026, 8, 20)
const base: SearchRequest = { query: 'source gathering', intent: 'research', depth: 'quick', count: 5 }

function client(reply: unknown, calls: Array<{ headers: Headers; body: Record<string, unknown> }>) {
  return exaClient({
    readKey: async (provider) => { assert.equal(provider, 'exa'); return 'exa-secret' },
    fetch: async (input, init) => {
      assert.equal(String(input), 'https://api.exa.ai/search')
      calls.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json' } })
    }
  }, now)
}

test('query requests highlights only; research requests page text and keeps it as content', async () => {
  const calls: Array<{ headers: Headers; body: Record<string, unknown> }> = []
  const page = 'x'.repeat(EXA_TEXT_CHARS)
  const exa = client({ results: [
    { title: 'Paper', url: 'https://example.org/paper', publishedDate: '2026-01-02T00:00:00.000Z', author: 'A. Author', highlights: ['Key passage', 'Second passage'], text: page },
    { title: 'Untitled', url: 'https://example.org/summary-only', summary: 'Summarized' },
    { title: 'No url' }
  ] }, calls)

  const quick = await exa.search(base, signal)
  assert.equal(calls[0].headers.get('x-api-key'), 'exa-secret')
  assert.deepEqual(calls[0].body, {
    query: 'source gathering', type: 'fast', numResults: 5,
    contents: { highlights: { query: 'source gathering', maxCharacters: 1500 } }
  })
  assert.equal(quick.results.length, 2)
  assert.equal(quick.results[0].snippet, 'Key passage\nSecond passage')
  assert.equal(quick.results[0].content, undefined, 'standalone queries never carry page text')
  assert.equal(quick.results[0].age, '2026-01-02T00:00:00.000Z')
  assert.deepEqual(quick.results[0].dates, [{ kind: 'index_reported', value: '2026-01-02T00:00:00.000Z', source: 'exa' }])
  assert.equal(quick.results[1].snippet, 'Summarized')

  const research = await exa.search({ ...base, depth: 'deep', sourceText: true }, signal)
  assert.deepEqual(calls[1].body.contents, {
    highlights: { query: 'source gathering', maxCharacters: 1500 },
    text: { maxCharacters: EXA_TEXT_CHARS, verbosity: 'compact' }
  })
  assert.equal(calls[1].body.type, 'auto')
  assert.deepEqual(research.results[0].content, { text: page, highlights: ['Key passage', 'Second passage'], truncated: true, author: 'A. Author' })
  assert.equal(research.results[1].content, undefined, 'results without text fall back to fetching')
})

test('filters map to published dates, domains, category, and location', async () => {
  const calls: Array<{ headers: Headers; body: Record<string, unknown> }> = []
  const exa = client({ results: [] }, calls)
  await exa.search({ ...base, intent: 'news', depth: 'balanced', count: 200, freshness: 'week', country: 'gb',
    includeDomains: ['https://Docs.Example.com/path'], excludeDomains: ['spam.example'] }, signal)
  assert.deepEqual(calls[0].body, {
    query: 'source gathering', type: 'auto', numResults: 100, category: 'news', userLocation: 'GB',
    startPublishedDate: '2026-09-13T00:00:00.000Z', includeDomains: ['docs.example.com'], excludeDomains: ['spam.example'],
    contents: { highlights: { query: 'source gathering', maxCharacters: 1500 } }
  })
  await exa.search({ ...base, freshness: '2026-01-01to2026-02-01' }, signal)
  assert.equal(calls[1].body.startPublishedDate, '2026-01-01T00:00:00.000Z')
  assert.equal(calls[1].body.endPublishedDate, '2026-02-01T23:59:59.999Z')
})

test('provider errors surface with status and detail', async () => {
  const exa = exaClient({ readKey: async () => 'k', fetch: async () => new Response('{"error":"quota"}', { status: 402 }) })
  await assert.rejects(exa.search(base, signal), /exa returned HTTP 402: \{"error":"quota"\}/)
})

test('adjustable discovery coverage and uncapped Contents do not imply full-fidelity extraction', async () => {
  const calls: Array<{ headers: Headers; body: Record<string, unknown> }> = []
  const exa = client({ results: [{ url: 'https://example.com', text: 'a'.repeat(200_000) }] }, calls)
  const capped = await exa.search({ ...base, sourceText: true, maxTextChars: 200_000 }, signal)
  assert.equal(capped.results[0].content?.truncated, true)
  const uncapped = await exa.search({ ...base, sourceText: true, maxTextChars: 0 }, signal)
  assert.deepEqual(calls[1].body.contents, { highlights: { query: base.query, maxCharacters: 1500 }, text: { verbosity: 'compact' } })
  assert.equal(uncapped.results[0].content?.text.length, 200_000)
  assert.equal(uncapped.results[0].content?.truncated, false)
  const page = await exaContents({ readKey: async () => 'fixture', fetch: async (url, init) => {
    assert.equal(url, 'https://api.exa.ai/contents')
    assert.deepEqual(JSON.parse(String(init?.body)), {
      ids: ['https://example.com'], text: { verbosity: 'full' }, maxAgeHours: 0, livecrawlTimeout: 15_000
    })
    return Response.json({ statuses: [{ status: 'success' }], results: [{ url: 'https://example.com', text: 'Entire extracted text' }] })
  } }, 'https://example.com', 0, signal)
  assert.equal(page.content?.text, 'Entire extracted text')
  await assert.rejects(exaContents({ readKey: async () => 'fixture', fetch: async () => Response.json({
    statuses: [{ status: 'error', error: { tag: 'CRAWL_NOT_FOUND' } }], results: []
  }) }, 'https://example.com', 0, signal), /CRAWL_NOT_FOUND/)
})
