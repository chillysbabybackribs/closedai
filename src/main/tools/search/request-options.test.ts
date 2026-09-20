import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { searchTools } from './index.js'

const context = { threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal }

test('Brave controls route automatically, preserve exclusions, and are independent of depth and cache', async () => {
  const urls: URL[] = []
  const registry = new ToolRegistry([searchTools({
    readKey: async (provider) => { assert.equal(provider, 'brave'); return 'fixture' },
    fetch: async (input) => {
      urls.push(new URL(String(input)))
      return new Response(JSON.stringify({ grounding: { generic: [] }, sources: {} }))
    }, now: () => Date.UTC(2026, 8, 20)
  })])
  const args = {
    query: 'original evidence', intent: 'research', depth: 'deep',
    preferred_domains: ['https://Docs.Example.com/reference'], exclude_domains: ['spam.example'],
    freshness: '2026-01-01to2026-09-20', relevance: 'strict', context_tokens: 4096
  }
  const call = async (overrides = {}) => {
    const result = await registry.call({ namespace: 'search', tool: 'query', arguments: { ...args, ...overrides } }, context)
    assert.equal(result.isError, undefined)
    return JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '')
  }
  const output = await call()
  assert.equal(urls[0].searchParams.get('goggles'), '$boost=3,site=docs.example.com')
  assert.equal(urls[0].searchParams.get('q'), 'original evidence -site:spam.example')
  assert.equal(urls[0].searchParams.get('freshness'), '2026-01-01to2026-09-20')
  assert.equal(urls[0].searchParams.get('context_threshold_mode'), 'strict')
  assert.equal(urls[0].searchParams.get('count'), '50')
  assert.equal(urls[0].searchParams.get('maximum_number_of_tokens'), '4096')
  assert.deepEqual(output.controls, { appliedTo: ['brave'], notAppliedTo: [] })
  assert.equal((await call()).cached, true)
  assert.equal(urls.length, 1)
  await call({ context_tokens: 8192 })
  await call({ preferred_domains: ['other.example'] })
  await call({ preferred_domains: [], goggles: '$downrank=3,site=spam.example' })
  assert.equal(urls.length, 4, 'different evidence controls must have different cache entries')
})

test('unsupported or conflicting controls fail before any provider request', async () => {
  let calls = 0
  const registry = new ToolRegistry([searchTools({ fetch: async () => { calls++; throw new Error('unexpected') }, readKey: async () => 'fixture' })])
  for (const options of [
    { context_tokens: 4096, providers: ['tavily'] },
    { preferred_domains: ['example.com'], providers: ['brave', 'serper'] },
    { preferred_domains: ['example.com'], goggles: '$boost,site=example.com' },
    { preferred_domains: ['bad domain'] },
    { freshness: '2026-02-30to2026-09-20' },
    { freshness: '2026-09-20to2026-01-01' },
    { query: 'x'.repeat(650), providers: ['brave'] }
  ]) {
    const result = await registry.call({ namespace: 'search', tool: 'query', arguments: { query: 'topic', intent: 'technical', ...options } }, context)
    assert.equal(result.isError, true, JSON.stringify(options))
  }
  assert.equal(calls, 0)
})

test('cached discovery reports original observation time without claiming current publication', async () => {
  let now = Date.UTC(2026, 8, 20)
  const registry = new ToolRegistry([searchTools({ now: () => now, readKey: async () => 'fixture',
    fetch: async () => new Response(JSON.stringify({ grounding: { generic: [{ url: 'https://example.com', title: 'Source', snippets: ['Excerpt'] }] },
      sources: { 'https://example.com': { age: ['January 1, 2020', '2020-01-01', '6 years ago'] } } }))
  })])
  const call = async () => {
    const result = await registry.call({ namespace: 'search', tool: 'query', arguments: { query: 'topic', intent: 'general' } }, context)
    return JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '')
  }
  const original = await call()
  now += 60_000
  const cached = await call()
  assert.equal(cached.observedAt, original.observedAt)
  assert.equal(cached.results[0].discovery.cached, true)
  assert.equal(cached.results[0].discovery.observedAt, original.observedAt)
  assert.equal(cached.results[0].dates[0].kind, 'index_reported')
  assert.equal(cached.results[0].dates[0].value, '6 years ago')
})
