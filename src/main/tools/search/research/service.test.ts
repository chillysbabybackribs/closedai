import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolContext } from '../../tool.js'
import { ToolRegistry } from '../../registry.js'
import { searchTools } from '../index.js'
import { SearchRouter } from '../router.js'
import type { ProviderSearchResult, SearchRequest } from '../types.js'
import { ResearchService, type ResearchDependencies, type ResearchInput } from './service.js'
import type { SourceDocument } from './source-reader.js'

const context: ToolContext = { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal }
const query: SearchRequest = { query: 'topic', intent: 'general', depth: 'balanced', count: 5 }
const input: ResearchInput = { queries: [query], urls: [], maxSources: 12, deadlineMs: 30_000, presentation: 'live' }
const document: SourceDocument = { url: 'https://example.com/source', title: 'Source', text: 'Actual evidence', contentType: 'text/plain', sha256: 'hash', incomplete: false }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function dependencies(overrides: Partial<ResearchDependencies> = {}): ResearchDependencies {
  return {
    owner: (caller) => ({ paneId: caller.paneId!, threadId: caller.threadId!, turnId: caller.turnId, workspace: '/workspace' }),
    collect: async () => document, read: async () => document.text, remove: async () => {}, openLive: () => 'live-tab',
    ...overrides
  }
}

test('provider fan-out, live tab opening, and source reading overlap; evidence precedes the slow provider', async (t) => {
  const slow = deferred<ProviderSearchResult>()
  const body = deferred<SourceDocument>()
  const started: string[] = []
  const router = new SearchRouter([
    { provider: 'brave', search: async () => { started.push('brave'); return { provider: 'brave', results: [{ title: 'Source', url: document.url, snippet: 'snippet', provider: 'brave' }] } } },
    { provider: 'serper', search: async () => { started.push('serper'); return slow.promise } }
  ])
  const service = new ResearchService(router, dependencies({
    collect: async () => { started.push('body'); return body.promise },
    openLive: () => { started.push('live'); return 'live-tab' }
  }))
  t.after(() => service.dispose())
  const run = service.start(input, context)
  assert.equal(run.state, 'running')
  assert.equal(run.presentation.tabId, 'live-tab')
  await tick()
  assert.deepEqual(new Set(started), new Set(['brave', 'serper', 'body', 'live']))
  body.resolve(document)
  await tick()
  const partial = service.read(run.runId, context)
  assert.equal(partial.state, 'running')
  assert.equal(partial.sources[0].state, 'ready')
  const source = await service.source(run.runId, partial.sources[0].id, context, 0, 200) as { text: string }
  assert.equal(source.text, 'Actual evidence')
  slow.resolve({ provider: 'serper', results: [{ title: 'Same source', url: document.url + '?utm_source=other', snippet: '', provider: 'serper' }] })
  await tick()
  const complete = service.read(run.runId, context)
  assert.equal(complete.state, 'completed')
  assert.equal(complete.sourceCount, 1)
  assert.deepEqual(complete.sources[0].discoveredBy, ['brave', 'serper'])
})

test('multiple queries start before either resolves and follow-ups join the same run', async (t) => {
  const gate = deferred<ProviderSearchResult>()
  const starts: string[] = []
  const service = new ResearchService(new SearchRouter([{ provider: 'brave', search: async (request) => {
    starts.push(request.query); return gate.promise
  } }]), dependencies())
  t.after(() => service.dispose())
  const run = service.start({ ...input, queries: [{ ...query, providers: ['brave'] }, { ...query, query: 'second', providers: ['brave'] }] }, context)
  await tick()
  assert.deepEqual(starts, ['topic', 'second'])
  service.extend(run.runId, [], [document.url], context)
  await tick()
  assert.equal(service.read(run.runId, context).sources[0].state, 'ready')
  gate.resolve({ provider: 'brave', results: [] })
  await tick()
  assert.equal(service.read(run.runId, context).totalQueries, 2)
})

test('cancellation aborts active collection and drops late results; other panes cannot inspect a run', async () => {
  const body = deferred<SourceDocument>()
  let signal!: AbortSignal
  const service = new ResearchService(new SearchRouter([]), dependencies({ collect: async (_url, _run, _source, inputSignal) => {
    signal = inputSignal; return body.promise
  } }))
  const run = service.start({ ...input, queries: [], urls: [document.url] }, context)
  await tick()
  assert.throws(() => service.read(run.runId, { ...context, paneId: 'other' }), /unavailable/)
  assert.throws(() => service.read(run.runId, { ...context, threadId: 'other' }), /unavailable/)
  service.cancelPane('pane')
  assert.equal(signal.aborted, true)
  body.resolve(document)
  await tick()
  const cancelled = service.read(run.runId, context)
  assert.equal(cancelled.state, 'cancelled')
  assert.equal(cancelled.pending, 0)
  assert.equal(cancelled.sources[0].state, 'failed')
  assert.equal(cancelled.sources[0].sha256, undefined)
})

test('event waits wake on new evidence; cancelling a wait does not cancel its run', async (t) => {
  const body = deferred<SourceDocument>()
  const service = new ResearchService(new SearchRouter([]), dependencies({ collect: async () => body.promise }))
  t.after(() => service.dispose())
  const run = service.start({ ...input, queries: [], urls: [document.url] }, context)
  await tick()
  const current = service.read(run.runId, context)
  const controller = new AbortController()
  const abandoned = service.wait(run.runId, { ...context, signal: controller.signal }, current.cursor, 1000)
  controller.abort(new Error('wait cancelled'))
  await assert.rejects(abandoned, /wait cancelled/)
  assert.equal(service.read(run.runId, context).state, 'running')
  const waiting = service.wait(run.runId, context, current.cursor, 1000)
  body.resolve(document)
  const update = await waiting
  assert.ok(update.cursor > current.cursor)
  assert.equal(update.sources[0].state, 'ready')
})

test('turn replacement stops a run and errors remain visible on otherwise completed runs', async (t) => {
  const gate = deferred<ProviderSearchResult>()
  const service = new ResearchService(new SearchRouter([{ provider: 'brave', search: async () => gate.promise }]), dependencies())
  t.after(() => service.dispose())
  const run = service.start({ ...input, queries: [{ ...query, providers: ['brave'] }] }, context)
  await tick()
  service.reconcile('pane', 'thread', 'new-turn')
  assert.equal(service.read(run.runId, context).state, 'cancelled')
  gate.resolve({ provider: 'brave', results: [] })
  const failures = new ResearchService(new SearchRouter([]), dependencies({ collect: async () => { throw new Error('HTTP 429') } }))
  t.after(() => failures.dispose())
  const failed = failures.start({ ...input, queries: [], urls: [document.url] }, context)
  await tick()
  assert.equal(failures.read(failed.runId, context).state, 'completed')
  assert.match(failures.read(failed.runId, context).sources[0].error!, /429/)
})

test('Stop rejects late research starts from that turn even before its provider acknowledges interruption', () => {
  const service = new ResearchService(new SearchRouter([]), dependencies())
  service.cancelPane('pane', 'thread', 'turn')
  assert.throws(() => service.start({ ...input, queries: [], urls: [document.url] }, context), /turn was stopped/)
  service.reconcile('pane', 'thread', 'next')
  const run = service.start({ ...input, queries: [], urls: [document.url] }, { ...context, turnId: 'next' })
  assert.equal(run.state, 'running')
  service.dispose()
})

test('registry exposes provider-neutral run/read actions, rejects oversize arrays, and preserves source pagination', async (t) => {
  let service!: ResearchService
  const registry = new ToolRegistry([searchTools({
    research: dependencies(), onResearchCreated: (value) => { service = value }
  })])
  t.after(() => service.dispose())
  const call = (tool: string, args: unknown) => registry.call({ namespace: 'search', tool, arguments: args }, context)
  const oversized = await call('run', { action: 'start', queries: Array(7).fill({ query: 'topic', intent: 'general' }) })
  assert.equal(oversized.isError, true)
  const started = await call('run', { action: 'start', urls: [document.url] })
  assert.equal(started.isError, undefined)
  const run = JSON.parse(started.content[0].type === 'text' ? started.content[0].text : '')
  assert.equal(run.presentation.state, 'opened')
  assert.equal(run.presentation.tabId, 'live-tab')
  await tick()
  const state = service.read(run.runId, context)
  const result = await call('read', { action: 'source', run_id: run.runId, source_id: state.sources[0].id, query: 'evidence' })
  const source = JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '')
  assert.equal(source.text, 'evidence')
  assert.equal(source.evidence, 'retrieved_document')
  assert.equal(source.untrusted, true)
})

test('source metadata is bounded and cursors do not skip omitted sources', async (t) => {
  const service = new ResearchService(new SearchRouter([]), dependencies({ collect: async (url) => ({ ...document, url }) }))
  t.after(() => service.dispose())
  const run = service.start({ ...input, maxSources: 20, queries: [], urls: Array.from({ length: 20 }, (_, i) => `https://example.com/${i}/${'a'.repeat(1500)}`) }, context)
  await tick()
  const seen = new Set<string>()
  let cursor = 0
  for (;;) {
    const page = service.read(run.runId, context, cursor)
    assert.ok(JSON.stringify(page).length < 17_000)
    for (const source of page.sources) seen.add(source.id)
    cursor = page.cursor
    if (!page.omittedSources) break
  }
  assert.equal(seen.size, 20)
})
