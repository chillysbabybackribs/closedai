import assert from 'node:assert/strict'
import test from 'node:test'
import { initialChatState, reduceChatWorkspaceEvent } from '../chat-state.ts'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.ts'

test('interleaved streams and history pages update their own visible pane', () => {
  const a = { ...initialChatState(), threadId: 'a', items: [{ type: 'assistant' as const, id: 'a1', text: 'A', turnId: 'at', phase: null, streaming: true }] }
  const b = { ...initialChatState(), threadId: 'b', items: [{ type: 'assistant' as const, id: 'b1', text: 'B', turnId: 'bt', phase: null, streaming: true }] }
  let state: ChatWorkspaceSnapshot = { selectedPaneId: 'a', selected: a, panes: { a, b }, chats: [] }
  state = reduceChatWorkspaceEvent(state, { type: 'pane', paneId: 'b', event: { type: 'itemDelta', itemId: 'b1', field: 'text', delta: ' second' } })
  assert.equal(state.selected, a)
  assert.equal(state.panes!.b!.items[0]!.type === 'assistant' && state.panes!.b!.items[0]!.text, 'B second')
  state = reduceChatWorkspaceEvent(state, { type: 'historyPage', paneId: 'b', threadId: 'b', beforeItemId: 'b1', page: {
    items: [{ type: 'user', id: 'b0', text: 'Earlier', turnId: null }], hasEarlier: false
  } })
  assert.deepEqual(state.panes!.b!.items.map((item) => item.id), ['b0', 'b1'])
  const switched = reduceChatWorkspaceEvent(state, { type: 'workspace', snapshot: { ...state, selectedPaneId: 'b', selected: b, panes: { a, b } } })
  assert.deepEqual(switched.selected.items.map((item) => item.id), ['b0', 'b1'])
  const stale = reduceChatWorkspaceEvent(state, { type: 'historyPage', paneId: 'b', threadId: 'old', beforeItemId: 'b0', page: { items: [], hasEarlier: false } })
  assert.equal(stale, state)
})
