import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chatTitle,
  coalesceChatEvents,
  initialChatState,
  initialChatWorkspaceState,
  reduceChatEvent,
  reduceChatWorkspaceEvent,
  summarizeMessage
} from './chat-state.js'

test('chat reducer upserts authoritative items without changing their order', () => {
  let state = initialChatState()
  state = reduceChatEvent(state, {
    type: 'item',
    item: { type: 'assistant', id: 'a', turnId: 't', text: '', phase: null, streaming: true }
  })
  state = reduceChatEvent(state, { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'hello' })
  state = reduceChatEvent(state, {
    type: 'item',
    item: { type: 'assistant', id: 'a', turnId: 't', text: 'hello!', phase: 'final_answer', streaming: false }
  })
  assert.deepEqual(state.items, [
    { type: 'assistant', id: 'a', turnId: 't', text: 'hello!', phase: 'final_answer', streaming: false }
  ])
})

test('chat reducer tracks the thread id and name together', () => {
  let state = reduceChatEvent(initialChatState(), { type: 'thread', threadId: 'thread-1', threadName: null })
  assert.equal(state.threadId, 'thread-1')
  assert.equal(state.threadName, null)
  state = reduceChatEvent(state, { type: 'thread', threadId: 'thread-1', threadName: 'Fix the build' })
  assert.equal(state.threadName, 'Fix the build')
})

test('chat reducer tracks a model selection', () => {
  const state = reduceChatEvent(initialChatState(), {
    type: 'model', selectedModel: 'gpt-5.6-terra', selectedReasoningEffort: 'high'
  })
  assert.equal(state.selectedModel, 'gpt-5.6-terra')
  assert.equal(state.selectedReasoningEffort, 'high')
})

test('chat reducer tracks reasoning effort independently', () => {
  const state = reduceChatEvent(initialChatState(), {
    type: 'reasoningEffort', selectedReasoningEffort: 'xhigh'
  })
  assert.equal(state.selectedReasoningEffort, 'xhigh')
})

test('workspace events update only the selected pane transcript', () => {
  let state = {
    ...initialChatWorkspaceState(),
    selectedPaneId: 'pane-a'
  }
  state = reduceChatWorkspaceEvent(state, {
    type: 'pane',
    paneId: 'pane-b',
    event: { type: 'turn', turnId: 'background' }
  })
  assert.equal(state.selected.activeTurnId, null)
  state = reduceChatWorkspaceEvent(state, {
    type: 'pane',
    paneId: 'pane-a',
    event: { type: 'turn', turnId: 'selected' }
  })
  assert.equal(state.selected.activeTurnId, 'selected')
})

test('display-only screenshots are retained in renderer state like transcript messages', () => {
  const screenshot = {
    type: 'screenshot' as const,
    id: 'shot-1',
    turnId: 'turn-1',
    imageUrl: 'data:image/png;base64,cG5n',
    surface: 'app_window' as const,
    caption: 'Surface: application window'
  }
  const state = reduceChatEvent(initialChatState(), { type: 'item', item: screenshot })
  assert.deepEqual(state.items, [screenshot])
})

test('chat title prefers the thread name, then the first user message', () => {
  let state = initialChatState()
  assert.equal(chatTitle(state), 'New chat')
  state = reduceChatEvent(state, { type: 'item', item: { type: 'user', id: 'u1', turnId: null, text: '  Refactor the composer\nmore detail' } })
  assert.equal(chatTitle(state), 'Refactor the composer')
  state = reduceChatEvent(state, { type: 'thread', threadId: 't', threadName: 'Composer work' })
  assert.equal(chatTitle(state), 'Composer work')
})

test('summarizeMessage truncates long first lines', () => {
  assert.equal(summarizeMessage('a'.repeat(100), 10), 'aaaaaaaaa…')
  assert.equal(summarizeMessage('   \n\n'), 'New chat')
})

test('context usage updates replace the previous reading', () => {
  const usage = { usedTokens: 50_000, contextWindow: 200_000, percent: 25 }
  const state = reduceChatEvent(initialChatState(), { type: 'context', usage })
  assert.deepEqual(state.contextUsage, usage)
  assert.equal(reduceChatEvent(state, { type: 'context', usage: null }).contextUsage, null)
})

test('coalescing merges adjacent deltas for one item and keeps other events in order', () => {
  const merged = coalesceChatEvents([
    { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'hel' },
    { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'lo' },
    { type: 'itemDelta', itemId: 'c', field: 'output', delta: 'ok\n' },
    { type: 'turn', turnId: null },
    { type: 'itemDelta', itemId: 'a', field: 'text', delta: '!' }
  ])
  assert.deepEqual(merged, [
    { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'hello' },
    { type: 'itemDelta', itemId: 'c', field: 'output', delta: 'ok\n' },
    { type: 'turn', turnId: null },
    { type: 'itemDelta', itemId: 'a', field: 'text', delta: '!' }
  ])
})

test('coalescing drops everything queued before a snapshot replace', () => {
  const snapshot = initialChatState()
  const merged = coalesceChatEvents([
    { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'stale' },
    { type: 'replace', snapshot },
    { type: 'turn', turnId: 't' }
  ])
  assert.deepEqual(merged, [{ type: 'replace', snapshot }, { type: 'turn', turnId: 't' }])
})

test('a delta leaves untouched items and unknown targets referentially stable', () => {
  const user = { type: 'user' as const, id: 'u', turnId: 't', text: 'hi' }
  let state = reduceChatEvent(initialChatState(), { type: 'item', item: user })
  state = reduceChatEvent(state, {
    type: 'item',
    item: { type: 'assistant', id: 'a', turnId: 't', text: '', phase: null, streaming: true }
  })
  const next = reduceChatEvent(state, { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'x' })
  assert.equal(next.items[0], state.items[0])
  assert.equal(next.items[1]?.type === 'assistant' && next.items[1].text, 'x')
  assert.equal(reduceChatEvent(state, { type: 'itemDelta', itemId: 'missing', field: 'text', delta: 'x' }), state)
})
