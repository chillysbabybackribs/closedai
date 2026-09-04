import assert from 'node:assert/strict'
import test from 'node:test'
import { SearchBrowserTabs, presentSearch } from './presentation.js'
import { searchTools } from './index.js'
import { ToolRegistry } from '../registry.js'
import type { ResearchService } from './research/service.js'

const context = { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal }

test('live search reuses one tab per pane/thread/turn without navigating the page again', () => {
  const urls: string[] = []
  const alive = new Set<string>()
  const tabs = new SearchBrowserTabs({
    exists: (id) => alive.has(id),
    open: (url) => { urls.push(url); const id = `tab-${urls.length}`; alive.add(id); return id }
  })
  assert.equal(tabs.open('https://one.example', context), 'tab-1')
  assert.equal(tabs.open('https://two.example', context), 'tab-1')
  assert.deepEqual(urls, ['https://one.example'])
  assert.equal(tabs.open('https://other.example', { ...context, paneId: 'other' }), 'tab-2')
  alive.delete('tab-1')
  assert.equal(tabs.open('https://reopened.example', context), 'tab-3')
  assert.equal(tabs.open('https://next.example', { ...context, turnId: 'next' }), 'tab-4')
})

test('both registry search paths open live by default, before API completion; background opts out', async (t) => {
  const urls: string[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let service!: ResearchService
  const tabs = new SearchBrowserTabs({ exists: () => true, open: (url) => { urls.push(url); return 'live-tab' } })
  const registry = new ToolRegistry([searchTools({
    readKey: async () => 'test',
    fetch: async (input) => {
      if (String(input).includes('api.search.brave.com')) {
        return new Response('{"web":{"results":[{"title":"Source","url":"https://source.example/article","description":"Evidence"}]}}', {
          headers: { 'content-type': 'application/json' }
        })
      }
      await gate
      return new Response('{"organic":[]}', { headers: { 'content-type': 'application/json' } })
    },
    onResearchCreated: (value) => { service = value },
    research: {
      owner: (ctx) => ({ paneId: ctx.paneId!, threadId: ctx.threadId!, turnId: ctx.turnId, workspace: '/test' }),
      openLive: (url, ctx) => tabs.open(url, ctx), collect: async () => { throw new Error('unused') },
      read: async () => '', remove: async () => {}
    }
  })])
  t.after(() => { release(); service.dispose() })
  const call = (tool: string, args: unknown) => registry.call({ namespace: 'search', tool, arguments: args }, context)
  const query = { query: 'design libraries', intent: 'technical', providers: ['brave', 'serper'] }
  const pending = call('query', query)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(urls.length, 1, 'query opens a real target before the API returns')
  const started = await call('run', { action: 'start', queries: [query, { ...query, query: 'other libraries' }] })
  const body = JSON.parse(started.content[0].type === 'text' ? started.content[0].text : '')
  assert.equal(body.presentation.state, 'waiting_for_source', 'omitting presentation must no longer select background')
  await new Promise<void>((resolve) => setImmediate(resolve))
  const live = service.read(body.runId, context)
  assert.equal(live.presentation.state, 'opened')
  assert.equal(live.presentation.tabId, 'live-tab')
  assert.equal(urls.length, 1, 'query and run share their turn tab')
  const background = await call('run', { action: 'start', queries: [query], presentation: 'background' })
  assert.match(background.content[0].type === 'text' ? background.content[0].text : '', /"state":"none"/)
  release()
  const result = await pending
  assert.match(result.content[0].type === 'text' ? result.content[0].text : '', /"tabId": "live-tab"/)
  await call('query', { ...query, presentation: 'background' })
  assert.equal(urls.length, 1)
})

test('browser failures and explicit background requests are reported honestly', () => {
  assert.deepEqual(presentSearch(undefined, 'https://example.com', context, 'background'), { state: 'none' })
  assert.deepEqual(presentSearch(undefined, 'https://example.com', context), { state: 'failed', error: 'Live browser is unavailable' })
})
