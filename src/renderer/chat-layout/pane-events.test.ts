import assert from 'node:assert/strict'
import test from 'node:test'
import { initialChatState, reduceChatWorkspaceEvent } from '../chat-state.ts'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.ts'

test('an early row summary cannot relabel the current transcript as another chat', () => {
  const a = { ...initialChatState(), threadId: 'thread-a' }
  const state: ChatWorkspaceSnapshot = { selectedPaneId: 'a', selected: a, panes: { a }, chats: [] }
  const early = reduceChatWorkspaceEvent(state, { type: 'chats', selectedPaneId: 'b', chats: [] })
  assert.equal(early.selectedPaneId, 'a')
  assert.equal(early.selected.threadId, 'thread-a')
})

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

test('moving a chat to a fresh runtime keeps previously expanded messages mounted', () => {
  const previous = { ...initialChatState(), threadId: 'old-thread', cwd: '/old', items: [
    { type: 'user' as const, id: 'earlier', turnId: null, text: 'Earlier turn' },
    { type: 'user' as const, id: 'latest', turnId: null, text: 'Current turn' }
  ] }
  const state: ChatWorkspaceSnapshot = { selectedPaneId: 'a', selected: previous, panes: { a: previous }, chats: [] }
  const next = { ...previous, threadId: null, cwd: '/new', items: previous.items.slice(1) }
  const moved = reduceChatWorkspaceEvent(state, { type: 'pane', paneId: 'a', event: { type: 'replace', snapshot: next } })
  assert.equal(moved.selected.cwd, '/new')
  assert.deepEqual(moved.selected.items.map((item) => item.id), ['earlier', 'latest'])
})


test('switching away and back keeps loaded history for attached chats', () => {
  const a = { ...initialChatState(), threadId: 'a', items: [
    { type: 'user' as const, id: 'old', turnId: 'old', text: 'Older prompt' },
    { type: 'user' as const, id: 'latest', turnId: 'latest', text: 'Latest prompt' }
  ] }
  const b = { ...initialChatState(), threadId: 'b' }
  const chats = [{ paneId: 'a', attached: true }, { paneId: 'b', attached: true }] as ChatWorkspaceSnapshot['chats']
  const state = { selectedPaneId: 'a', selected: a, panes: { a }, chats }
  const away = reduceChatWorkspaceEvent(state, { type: 'workspace', snapshot: {
    selectedPaneId: 'b', selected: b, panes: { b }, chats
  } })
  const tail = { ...a, items: a.items.slice(1), history: { hasEarlier: true } }
  const back = reduceChatWorkspaceEvent(away, { type: 'workspace', snapshot: {
    selectedPaneId: 'a', selected: tail, panes: { a: tail }, chats
  } })
  assert.deepEqual(back.selected.items, a.items)
  const closed = reduceChatWorkspaceEvent(back, { type: 'workspace', snapshot: {
    selectedPaneId: 'b', selected: b, panes: { b }, chats: chats.slice(1)
  } })
  assert.equal(closed.panes?.a, undefined)
})
