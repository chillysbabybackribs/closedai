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

test('search.query defaults to quick depth when omitted', async () => {
  const providers: SearchProvider[] = []
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('brave.com')) return json({ grounding: { generic: [] }, sources: {} })
    if (url.includes('serper.dev')) return json({ organic: [] })
    if (url.includes('tavily.com')) return json({ results: [] })
    return json({ results: { web: [] } })
  }
  const registry = new ToolRegistry([searchTools({ fetch: fetchMock, readKey: async (provider) => { providers.push(provider); return 'key' } })])
  await registry.call({ namespace: 'search', tool: 'query', arguments: { query: 'topic', intent: 'general' } }, context)
  assert.deepEqual(providers, ['brave'])
})

test('intent and depth select complementary provider sets', () => {
  assert.deepEqual(selectProviders(baseRequest), ['brave', 'serper'])
  assert.deepEqual(selectProviders({ ...baseRequest, intent: 'research', depth: 'deep' }), ['tavily', 'you', 'brave'])
  assert.deepEqual(selectProviders({ ...baseRequest, intent: 'finance', depth: 'quick' }), ['you'])
  assert.deepEqual(selectProviders({ ...baseRequest, providers: ['tavily', 'tavily', 'brave'] }), ['tavily', 'brave'])
})

test('one tool can call all four providers, normalize results, deduplicate, and cache', async () => {
  const keyReads: SearchProvider[] = []
  const calls: string[] = []
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('brave.com')) return json({
      grounding: { generic: [{
        title: 'Shared', url: 'https://example.com/item?utm_source=brave', snippets: ['Brave result']
      }] },
      sources: { 'https://example.com/item?utm_source=brave': { age: ['January 1, 2026', '2026-01-01', '2 days ago'] } }
    })
    if (url.includes('serper.dev')) return json({ organic: [{ title: 'Shared', link: 'https://example.com/item', snippet: 'Serper result', position: 1 }] })
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
    providers: ['brave', 'serper', 'tavily', 'you']
  }
  const first = await registry.call({ namespace: 'search', tool: 'query', arguments: args }, context)
  assert.equal(first.isError, undefined)
  const output = JSON.parse(first.content[0]!.type === 'text' ? first.content[0].text : '')
  assert.deepEqual(keyReads.sort(), ['brave', 'serper', 'tavily', 'you'])
  assert.equal(calls.length, 4)
  assert.equal(output.results.length, 3)
  assert.equal(output.results[0].snippet, 'Brave result')
  assert.equal(output.results[0].age, '2 days ago')
  assert.deepEqual(output.results[0].corroboratedBy, ['serper'])
  assert.deepEqual(output.answers, [{ provider: 'tavily', text: 'Tavily synthesis' }])
  assert.doesNotMatch(JSON.stringify(output), /secret-/)
  const deepBrave = new URL(calls.find((url) => url.includes('brave.com'))!)
  assert.equal(deepBrave.searchParams.get('count'), '50')
  assert.equal(deepBrave.searchParams.get('maximum_number_of_urls'), '3')
  assert.equal(deepBrave.searchParams.get('maximum_number_of_tokens'), '16384')
  assert.equal(deepBrave.searchParams.get('context_threshold_mode'), 'lenient')

  const second = await registry.call({ namespace: 'search', tool: 'query', arguments: args }, context)
  const cached = JSON.parse(second.content[0]!.type === 'text' ? second.content[0].text : '')
  assert.equal(cached.cached, true)
  assert.equal(calls.length, 4)

  const live = await registry.call({ namespace: 'search', tool: 'query', arguments: { ...args, live: true } }, context)
  const refreshed = JSON.parse(live.content[0]!.type === 'text' ? live.content[0].text : '')
  assert.equal(refreshed.cached, undefined)
  assert.equal(calls.length, 8)
})

test('provider requests use current search endpoints, filters, depth modes, and response fields', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = []
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
    calls.push({ url, body, headers: new Headers(init?.headers) })
    if (url.includes('brave.com')) return json({ grounding: { generic: [] }, sources: {} })
    if (url.includes('serper.dev')) return json({ news: [] })
    if (url.includes('tavily.com')) return json({ results: [] })
    return json({ results: {
      web: [{ title: 'You result', url: 'https://you.example/result', contents: { highlights: ['Useful highlight'] } }],
      ...(body.knowledge === 'core' ? { knowledge: [{ type: 'answer', description: 'Knowledge answer' }] } : {})
    } })
  }
  const registry = new ToolRegistry([searchTools({ fetch: fetchMock, readKey: async () => 'test' })])
  const call = (args: Record<string, unknown>) => registry.call({
    namespace: 'search', tool: 'query', arguments: { count: 4, ...args }
  }, context)

  await call({
    query: 'release notes', intent: 'news', depth: 'quick', live: true,
    providers: ['brave', 'serper', 'tavily', 'you'],
    freshness: 'day', country: 'us', language: 'en-GB',
    include_domains: ['https://Example.com/path'], exclude_domains: ['bad.example']
  })
  const brave = calls.find((item) => item.url.includes('brave.com'))!
  const braveUrl = new URL(brave.url)
  assert.equal(braveUrl.pathname, '/res/v1/llm/context')
  assert.equal(braveUrl.searchParams.get('q'), 'release notes site:example.com -site:bad.example')
  assert.equal(braveUrl.searchParams.get('count'), '10')
  assert.equal(braveUrl.searchParams.get('maximum_number_of_urls'), '4')
  assert.equal(braveUrl.searchParams.get('maximum_number_of_tokens'), '2048')
  assert.equal(braveUrl.searchParams.get('maximum_number_of_tokens_per_url'), '1024')
  assert.equal(braveUrl.searchParams.get('context_threshold_mode'), 'strict')
  assert.equal(braveUrl.searchParams.get('enable_source_metadata'), 'true')
  assert.equal(braveUrl.searchParams.get('safesearch'), 'moderate')
  assert.equal(braveUrl.searchParams.get('freshness'), 'pd')
  assert.equal(braveUrl.searchParams.get('country'), 'US')
  assert.equal(braveUrl.searchParams.get('search_lang'), 'en')
  assert.equal(brave.headers.get('cache-control'), 'no-cache')

  const serper = calls.find((item) => item.url.includes('serper.dev'))!
  assert.equal(serper.url, 'https://google.serper.dev/news')
  assert.deepEqual(serper.body, {
    q: 'release notes site:example.com -site:bad.example', num: 4, gl: 'us', hl: 'en', tbs: 'qdr:d'
  })

  const tavily = calls.find((item) => item.url.includes('tavily.com'))!
  assert.deepEqual(tavily.body, {
    query: 'release notes', search_depth: 'fast', topic: 'news', max_results: 4,
    include_answer: false, chunks_per_source: 1, time_range: 'day',
    include_domains: ['example.com'], exclude_domains: ['bad.example'],
    language: 'en-gb', filter_by_language: true
  })

  const you = calls.find((item) => item.url.includes('ydc-index.io'))!
  assert.equal(you.url, 'https://ydc-index.io/v1/search')
  assert.deepEqual(you.body, {
    query: 'release notes site:example.com -site:bad.example', count: 4,
    freshness: 'day', country: 'US', language: 'EN-GB'
  })

  await call({ query: 'regional topic', intent: 'general', depth: 'balanced', providers: ['tavily'], country: 'us' })
  assert.equal(calls.at(-1)!.body.country, 'united states')
  assert.equal(calls.at(-1)!.body.search_depth, 'basic')

  const answerResponse = await call({ query: 'explain it', intent: 'answer', providers: ['you'] })
  const answer = JSON.parse(answerResponse.content[0]!.type === 'text' ? answerResponse.content[0].text : '')
  assert.equal(calls.at(-1)!.body.knowledge, 'core')
  assert.deepEqual(answer.answers, [{ provider: 'you', text: 'Knowledge answer' }])
  assert.equal(answer.results[0].snippet, 'Useful highlight')
})

test('partial provider failures are returned while useful evidence survives', async () => {
  const router = new SearchRouter([
    fakeClient('brave', [{ title: 'Good', url: 'https://example.com', snippet: 'ok', provider: 'brave' }]),
    { provider: 'serper', search: async () => { throw new Error('quota exceeded') } }
  ])
  const response = await router.search(baseRequest, context.signal)
  assert.equal(response.results.length, 1)
  assert.deepEqual(response.errors, [{ provider: 'serper', message: 'quota exceeded' }])
  const retried = await router.search(baseRequest, context.signal)
  assert.equal(retried.cached, undefined, 'a partial failure must not be cached as a healthy search')
})

function fakeClient(provider: SearchProvider, results: Parameters<typeof Promise.resolve>[0][] | never[]): SearchProviderClient {
  return { provider, search: async () => ({ provider, results: results as never }) }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
