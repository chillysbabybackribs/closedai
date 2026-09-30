import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatRecord } from '../../shared/chat-store.js'
import { chatRecord } from '../chat-peers/peer-manager-harness.js'
import { mergedPaneTranscriptItems } from './pane-transcript-merge.js'

const pane = (patch: Partial<ChatRecord> = {}): ChatRecord => chatRecord('p', null, {
  codexThreadId: 'new',
  threadId: 'new',
  continuation: {
    sourcePaneId: 'p',
    sourceThreadId: 'old',
    sourceProvider: 'codex',
    sourceTitle: 'Old',
    sourceThroughItemId: 'old-item',
    handoff: null,
    createdAt: 1
  },
  sessionRotations: [{ epoch: 1, sourceThroughItemId: 'old-item', providerThreadId: 'old', at: 1 }],
  ...patch
})

test('mergedPaneTranscriptItems merges when rotation boundary is missing from snapshot', async () => {
  const snapshot = [{ type: 'user' as const, id: 'u2', turnId: 't2', text: 'After' }]
  const { items, partial } = await mergedPaneTranscriptItems(pane(), snapshot, async () => ({
    items: [{ type: 'user', id: 'u1', turnId: 't', text: 'Before' }]
  }), 'chat')
  assert.deepEqual(items.map((item) => item.id), ['u1', 'u2'])
  assert.equal(partial, false)
})

test('mergedPaneTranscriptItems skips read when boundary item is still in snapshot', async () => {
  let reads = 0
  const snapshot = [
    { type: 'user' as const, id: 'u1', turnId: 't', text: 'Ask' },
    { type: 'user' as const, id: 'boundary', turnId: 't', text: 'Boundary' }
  ]
  const record = pane({ sessionRotations: [{ epoch: 1, sourceThroughItemId: 'boundary', providerThreadId: 'old', at: 1 }] })
  const { items } = await mergedPaneTranscriptItems(record, snapshot, async () => { reads++; return { items: [] } }, 'chat')
  assert.equal(reads, 0)
  assert.equal(items.length, 2)
})
