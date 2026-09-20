import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResearchActivityEvent } from '../../../../shared/web-research.js'
import type { ToolContext } from '../../tool.js'
import { SearchRouter } from '../router.js'
import type { ProviderSearchResult, SearchRequest } from '../types.js'
import { ActivityPublisher, toActivity, type ActivityRun } from './activity.js'
import { ResearchService, type ResearchDependencies, type ResearchInput } from './service.js'
import type { SourceDocument } from './source-reader.js'

const context: ToolContext = { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal }
const query: SearchRequest = { query: 'topic', intent: 'general', depth: 'quick', count: 5 }
const input: ResearchInput = { queries: [query], urls: [], maxSources: 12, deadlineMs: 30_000, presentation: 'live' }
const document: SourceDocument = { url: 'https://example.com/source', title: 'Source', text: 'Actual evidence for the user', contentType: 'text/plain', sha256: 'hash', incomplete: false }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 120))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const deps: ResearchDependencies = {
  owner: (caller) => ({ paneId: caller.paneId!, threadId: caller.threadId!, turnId: caller.turnId, workspace: '/workspace' }),
  collect: async () => document, read: async () => document.text, remove: async () => {}, openLive: () => 'live-tab'
}

test('activity derives counts and bounded facts from a run', () => {
  const run: ActivityRun = {
    id: 'run', owner: { paneId: 'pane', threadId: 'thread', turnId: 'turn', workspace: '/w' }, state: 'running', pending: 2,
    startedAt: 10, queries: ['a', 'b'], completedQueries: 1,
    sources: new Map([
      ['x', { id: 'x', url: 'https://x.example', title: 'X', discoveredBy: ['brave'], snippet: 'long snippet', state: 'ready', revision: 3, chars: 120, incomplete: true }],
      ['y', { id: 'y', url: 'https://y.example', title: 'Y', discoveredBy: [], snippet: '', state: 'failed', revision: 4, error: 'HTTP 500' }]
    ]),
    errors: [{ query: 'a', provider: 'serper', message: 'quota' }], presentation: { snapshot: () => ({ state: 'opened', tabId: 'tab' }) }
  }
  const activity = toActivity(run)
  assert.deepEqual(activity.counts, { queued: 0, reading: 0, ready: 1, failed: 1 })
  assert.deepEqual(activity.sources.map((source) => source.id), ['x', 'y'])
  assert.equal('snippet' in activity.sources[0]!, false, 'snippets are model evidence, not user activity')
  assert.equal(activity.sources[0]!.incomplete, true)
  assert.equal(activity.sources[1]!.error, 'HTTP 500')
  assert.equal(activity.turnId, 'turn')
  assert.deepEqual(activity.presentation, { state: 'opened', tabId: 'tab' })
})

test('a burst of changes coalesces into one event; finishing flushes at once; eviction is announced', async () => {
  const publisher = new ActivityPublisher()
  const events: ResearchActivityEvent[] = []
  const unsubscribe = publisher.subscribe((event) => events.push(event))
  const run: ActivityRun = {
    id: 'run', owner: { paneId: 'pane', threadId: 'thread', turnId: 'turn', workspace: '/w' }, state: 'running', pending: 1,
    startedAt: 1, queries: [], completedQueries: 0, sources: new Map(), errors: [], presentation: { snapshot: () => ({ state: 'none' }) }
  }
  publisher.schedule(run); publisher.schedule(run); publisher.schedule(run)
  assert.equal(events.length, 0, 'coalescing window has not elapsed')
  run.state = 'completed'
  publisher.flush(run)
  assert.equal(events.length, 1)
  assert.equal(events[0]!.type === 'run' && events[0]!.run.state, 'completed')
  await settle()
  assert.equal(events.length, 1, 'the flushed timer did not fire again')
  publisher.evicted('run')
  assert.deepEqual(events[1], { type: 'evicted', runId: 'run' })
  unsubscribe()
  publisher.schedule(run)
  await settle()
  assert.equal(events.length, 2)
})

test('the service publishes pane activity, serves user excerpts, and honors a user Stop', async (t) => {
  const gate = deferred<ProviderSearchResult>()
  const router = new SearchRouter([{ provider: 'brave', search: async () => gate.promise }])
  const service = new ResearchService(router, deps)
  t.after(() => service.dispose())
  const events: ResearchActivityEvent[] = []
  service.subscribe((event) => events.push(event))
  const run = service.start({ ...input, urls: [document.url] }, context)
  await tick()
  await settle()
  const latest = events.filter((event) => event.type === 'run').at(-1)
  assert.ok(latest && latest.type === 'run')
  assert.equal(latest.run.paneId, 'pane')
  assert.deepEqual(latest.run.queries, ['topic'])
  assert.equal(latest.run.counts.ready, 1)
  assert.equal(latest.run.state, 'running')
  const listed = service.activity('pane')
  assert.deepEqual(listed.map((item) => item.runId), [run.runId])
  assert.deepEqual(service.activity('other'), [])
  const sourceId = listed[0]!.sources[0]!.id
  const first = await service.excerpt(run.runId, sourceId, 0, 10)
  assert.equal(first.text, 'Actual evi')
  assert.equal(first.nextOffset, 10)
  assert.equal(first.chars, document.text.length)
  const rest = await service.excerpt(run.runId, sourceId, first.nextOffset!, 100)
  assert.equal(rest.text, 'dence for the user')
  assert.equal(rest.nextOffset, null)
  const before = events.length
  service.cancelRun(run.runId)
  assert.equal(events.length, before + 1, 'a finish flushes immediately')
  const final = events.at(-1)
  assert.ok(final && final.type === 'run' && final.run.state === 'cancelled' && final.run.finishedAt !== undefined)
  assert.throws(() => service.cancelRun('missing'), /no longer retained/)
  gate.resolve({ provider: 'brave', results: [] })
})
