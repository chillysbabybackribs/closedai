import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { searchTools, selectProviders, SearchRouter } from './index.js'
import type { SearchProvider, SearchProviderClient, SearchRequest } from './types.js'

const context = {
  threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal
}

const baseRequest: SearchRequest = {
  query: 'closedai search', intent: 'general', depth: 'balanced', count: 5
}

test('intent and depth select complementary provider sets', () => {
  assert.deepEqual(selectProviders(baseRequest), ['brave', 'serper'])
  assert.deepEqual(selectProviders({ ...baseRequest, intent: 'research', depth: 'deep' }), ['tavily', 'jina', 'you'])
  assert.deepEqual(selectProviders({ ...baseRequest, intent: 'finance', depth: 'quick' }), ['you'])
  assert.deepEqual(selectProviders({ ...baseRequest, providers: ['jina', 'jina', 'brave'] }), ['jina', 'brave'])
})

test('one tool can call all five providers, normalize results, deduplicate, and cache', async () => {
  const keyReads: SearchProvider[] = []
  const calls: string[] = []
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('brave.com')) return json({ web: { results: [{ title: 'Shared', url: 'https://example.com/item?utm_source=brave', description: 'Brave result' }] } })
    if (url.includes('serper.dev')) return json({ organic: [{ title: 'Shared', link: 'https://example.com/item', snippet: 'Serper result', position: 1 }] })
    if (url.includes('jina.ai')) return json({ data: [{ title: 'Docs', url: 'https://docs.example/a', content: 'Dense docs' }] })
    if (url.includes('tavily.com')) return json({ answer: 'Tavily synthesis', results: [{ title: 'Research', url: 'https://research.example/a', content: 'Research result', score: 0.9 }] })
    return json({ results: { web: [{ title: 'You', url: 'https://you.example/a', description: 'You result' }] } })
  }
  const registry = new ToolRegistry([searchTools({
    fetch: fetchMock,
    readKey: async (provider) => { keyReads.push(provider); return `secret-${provider}` },
    now: () => 1_000
  })])
  const args = {
    query: 'closedai search', intent: 'general', depth: 'deep', count: 3,
    providers: ['brave', 'serper', 'jina', 'tavily', 'you']
  }
  const first = await registry.call({ namespace: 'search', tool: 'query', arguments: args }, context)
  assert.equal(first.isError, undefined)
  const output = JSON.parse(first.content[0]!.type === 'text' ? first.content[0].text : '')
  assert.deepEqual(keyReads.sort(), ['brave', 'jina', 'serper', 'tavily', 'you'])
  assert.equal(calls.length, 5)
  assert.equal(output.results.length, 4)
  assert.deepEqual(output.results[0].corroboratedBy, ['serper'])
  assert.deepEqual(output.answers, [{ provider: 'tavily', text: 'Tavily synthesis' }])
  assert.doesNotMatch(JSON.stringify(output), /secret-/)

  const second = await registry.call({ namespace: 'search', tool: 'query', arguments: args }, context)
  const cached = JSON.parse(second.content[0]!.type === 'text' ? second.content[0].text : '')
  assert.equal(cached.cached, true)
  assert.equal(calls.length, 5)

  const live = await registry.call({ namespace: 'search', tool: 'query', arguments: { ...args, live: true } }, context)
  const refreshed = JSON.parse(live.content[0]!.type === 'text' ? live.content[0].text : '')
  assert.equal(refreshed.cached, undefined)
  assert.equal(calls.length, 10)
})

test('partial provider failures are returned while useful evidence survives', async () => {
  const router = new SearchRouter([
    fakeClient('brave', [{ title: 'Good', url: 'https://example.com', snippet: 'ok', provider: 'brave' }]),
    { provider: 'serper', search: async () => { throw new Error('quota exceeded') } }
  ])
  const response = await router.search(baseRequest, context.signal)
  assert.equal(response.results.length, 1)
  assert.deepEqual(response.errors, [{ provider: 'serper', message: 'quota exceeded' }])
})

function fakeClient(provider: SearchProvider, results: Parameters<typeof Promise.resolve>[0][] | never[]): SearchProviderClient {
  return { provider, search: async () => ({ provider, results: results as never }) }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
