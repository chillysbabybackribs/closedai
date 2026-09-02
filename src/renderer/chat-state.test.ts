import assert from 'node:assert/strict'
import test from 'node:test'
import { chatTitle, initialChatState, reduceChatEvent, summarizeMessage } from './chat-state.js'

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

test('chat reducer resolves only the matching approval', () => {
  const approval = {
    requestId: '7',
    kind: 'command' as const,
    threadId: 'thread',
    turnId: 'turn',
    itemId: 'item',
    title: 'Allow command?',
    detail: 'npm test',
    reason: null
  }
  let state = reduceChatEvent(initialChatState(), { type: 'approval', approval })
  state = reduceChatEvent(state, { type: 'approvalResolved', requestId: '8' })
  assert.equal(state.approvals.length, 1)
  state = reduceChatEvent(state, { type: 'approvalResolved', requestId: '7' })
  assert.equal(state.approvals.length, 0)
})

test('chat reducer tracks the thread id and name together', () => {
  let state = reduceChatEvent(initialChatState(), { type: 'thread', threadId: 'thread-1', threadName: null })
  assert.equal(state.threadId, 'thread-1')
  assert.equal(state.threadName, null)
  state = reduceChatEvent(state, { type: 'thread', threadId: 'thread-1', threadName: 'Fix the build' })
  assert.equal(state.threadName, 'Fix the build')
})

test('chat reducer tracks a model selection', () => {
  const state = reduceChatEvent(initialChatState(), { type: 'model', selectedModel: 'gpt-5.6-terra' })
  assert.equal(state.selectedModel, 'gpt-5.6-terra')
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
