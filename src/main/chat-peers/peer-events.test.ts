import assert from 'node:assert/strict'
import test from 'node:test'
import type { CachedChatView } from '../chat-store/chat-transcript-cache.js'
import { chatRowSummariesEqual, readableView, rendererChatBatcher, rendererSnapshot, rowSummary } from './peer-events.js'
import { chatRecord, FakeSurface } from './peer-manager-harness.js'

const cached: CachedChatView = {
  version: 1,
  threadId: 'codex:t1',
  threadName: 'Saved chat',
  items: [{ type: 'user', id: 'u', turnId: 't', text: 'the request' }],
  hasEarlier: true,
  contextUsage: null,
  updatedAt: 1
}

test('renderer snapshots keep only the latest turn for the live pane', () => {
  const snapshot = rendererSnapshot({
    provider: 'codex',
    connection: { state: 'ready', message: 'ready' },
    account: null,
    models: [],
    selectedModel: null,
    selectedReasoningEffort: null,
    cwd: '/w',
    threadId: 'codex:t1',
    threadName: null,
    activeTurnId: 't2',
    pausedTurnId: null,
    contextUsage: null,
    planUsage: null,
    items: [
      { type: 'user', id: 'u1', turnId: 't1', text: 'first' },
      { type: 'assistant', id: 'a1', turnId: 't1', text: 'one', phase: null, streaming: false },
      { type: 'user', id: 'u2', turnId: 't2', text: 'second' },
      { type: 'assistant', id: 'a2', turnId: 't2', text: 'two', phase: null, streaming: false }
    ]
  }, 'Example')
  assert.deepEqual(snapshot.items.map((item) => item.id), ['u2', 'a2'])
  assert.equal(snapshot.history?.hasEarlier, true)
})

test('a peer reads a parked pane from its saved view rather than as an empty chat', () => {
  const parked = new FakeSurface('gpt').snapshot()
  const record = chatRecord('pane-a', 'gpt', { threadId: 'codex:t1' })
  const saved = readableView(parked, record, cached)
  assert.equal(saved.source, 'saved')
  assert.deepEqual(saved.snapshot.items.map((item) => item.id), ['u'])
  assert.equal(saved.snapshot.history?.hasEarlier, true)
})

test('nothing stale stands in: a chat that left the view’s thread, or has none, reads live', () => {
  const parked = new FakeSurface('gpt').snapshot()
  assert.equal(readableView(parked, chatRecord('pane-a', 'gpt', { threadId: 'codex:t2' }), cached).source, 'live')
  assert.equal(readableView(parked, chatRecord('pane-a', 'gpt', { threadId: 'codex:t1' }), null).source, 'live')
  assert.equal(readableView(parked, undefined, cached).source, 'live')
})

test('a live transcript is never overridden by the saved one', () => {
  const surface = new FakeSurface('gpt')
  surface.state.items = [{ type: 'assistant', id: 'a', turnId: 't', text: 'live answer', phase: null, streaming: false }]
  const live = surface.snapshot()
  const result = readableView(live, chatRecord('pane-a', 'gpt', { threadId: 'codex:t1' }), cached)
  assert.equal(result.source, 'live')
  assert.equal(result.snapshot, live)
})

test('active checkpoint memory is attached when thread ids match', () => {
  const parked = new FakeSurface('gpt').snapshot()
  const checkpoint: import('../../shared/chat-memory.js').ChatMemoryCheckpoint = {
    version: 1, revision: 1, threadId: 'codex:t1', throughItemId: 'u', createdAt: 1,
    state: { goal: 'Goal', constraints: [], decisions: [], progress: [], nextSteps: [], files: [] }
  }
  const record = chatRecord('pane-a', 'gpt', { threadId: 'codex:t1', checkpoint })
  const saved = readableView(parked, record, cached)
  assert.equal(saved.snapshot.checkpoint, checkpoint)

  const wrongThreadRecord = chatRecord('pane-a', 'gpt', { threadId: 'codex:t2', checkpoint })
  const noMatch = readableView(parked, wrongThreadRecord, cached)
  assert.equal(noMatch.snapshot.checkpoint ?? null, null)
})

test('a drawer row names the chat it continues while the digest is undelivered', () => {
  const lineage = {
    sourcePaneId: 'pane-a', sourceThreadId: 'codex:t1', sourceProvider: 'codex' as const,
    sourceTitle: 'Parser work', handoff: 'Handoff from the previous chat "Parser work".', createdAt: 1
  }
  const pending = rowSummary(chatRecord('pane-b', 'gpt', { continuation: lineage }), null)
  assert.deepEqual(pending.continuedFrom, {
    paneId: 'pane-a', title: 'Parser work', handoff: lineage.handoff, previewUser: null, previewAssistant: null
  })

  // Delivered: the lineage stays on the row without the text the first message already carried.
  const delivered = rowSummary(chatRecord('pane-b', 'gpt', { continuation: { ...lineage, handoff: null } }), null)
  assert.deepEqual(delivered.continuedFrom, {
    paneId: 'pane-a', title: 'Parser work', handoff: null, previewUser: null, previewAssistant: null
  })

  // A directory change within one chat re-seeds that chat; it is not a continuation of another.
  const moved = rowSummary(chatRecord('pane-b', 'gpt', { continuation: { ...lineage, sourceCwd: '/old' } }), null)
  assert.equal('continuedFrom' in moved, false)
  assert.equal('continuedFrom' in rowSummary(chatRecord('pane-b', 'gpt'), null), false)
})

test('IPC batching merges adjacent deltas and flushes them before ordering barriers', () => {
  const sent: import('../../shared/chat-peers.js').ChatWorkspaceEvent[] = []
  const measurements: import('./peer-events.js').RendererChatIpcMetrics[] = []
  const batch = rendererChatBatcher((event) => sent.push(event), (value) => measurements.push(value), 60_000)
  try {
    batch({ type: 'pane', paneId: 'pane-a', event: { type: 'turn', turnId: 'turn-a' } })
    batch({ type: 'pane', paneId: 'pane-a', event: { type: 'itemDelta', itemId: 'answer', field: 'text', delta: 'a' } })
    batch({ type: 'pane', paneId: 'pane-a', event: { type: 'itemDelta', itemId: 'answer', field: 'text', delta: 'b' } })
    assert.equal(sent.length, 1, 'deltas wait briefly instead of crossing IPC one by one')

    batch({ type: 'pane', paneId: 'pane-a', event: { type: 'context', usage: null } })
    batch({ type: 'pane', paneId: 'pane-a', event: { type: 'itemDelta', itemId: 'answer', field: 'text', delta: 'c' } })
    batch({ type: 'pane', paneId: 'pane-a', event: { type: 'turn', turnId: null } })

    assert.deepEqual(sent.map((event) => event.type === 'pane' ? event.event.type : event.type),
      ['turn', 'itemDelta', 'context', 'itemDelta', 'turn'])
    const merged = sent[1]
    assert.equal(merged?.type === 'pane' && merged.event.type === 'itemDelta' && merged.event.delta, 'ab')
    assert.deepEqual(measurements, [{
      paneId: 'pane-a', turnId: 'turn-a', receivedEvents: 6, sentEvents: 5,
      receivedDeltas: 3, sentDeltas: 2, deltaCharacters: 3
    }])
  } finally {
    batch.dispose()
  }
})

test('chatRowSummariesEqual compares drawer fields, not array identity', () => {
  const row = rowSummary(chatRecord('pane-a', 'gpt', { title: 'T' }), null)
  assert.ok(chatRowSummariesEqual([row], [{ ...row }]))
  assert.equal(chatRowSummariesEqual([row], [{ ...row, providerUsage: {
    usage: null, account: null, connection: { state: 'ready', message: 'Ready' }
  } }]), false)
  assert.equal(chatRowSummariesEqual([row], [{ ...row, preview: 'other' }]), false)
  assert.equal(chatRowSummariesEqual([row], [{ ...row, quickChatSurface: 'notepad' }]), false)
})

test('rowSummary carries quickChatSurface from the store record', () => {
  const row = rowSummary(chatRecord('pane-a', 'gpt', { title: 'T', quickChatSurface: 'notepad' }), null)
  assert.equal(row.quickChatSurface, 'notepad')
})
