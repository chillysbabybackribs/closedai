import assert from 'node:assert/strict'
import test from 'node:test'
import type { CachedChatView } from '../chat-store/chat-transcript-cache.js'
import { readableView } from './peer-events.js'
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
