import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chatTitle,
  coalesceChatEvents,
  coalesceChatWorkspaceEvents,
  initialChatState,
  initialChatWorkspaceState,
  initialChatRendererState,
  reduceChatRendererEvent,
  reduceChatEvent,
  reduceChatWorkspaceEvent,
  summarizeMessage
} from './chat-state.js'

test('a burst of text and output deltas leaves sidebar state stable until a meaningful event', () => {
  let state = initialChatRendererState()
  state = reduceChatRendererEvent(state, { type: 'workspace', snapshot: {
    ...initialChatWorkspaceState(), selectedPaneId: 'pane-a', selected: { ...initialChatState(), items: [
      { type: 'assistant', id: 'a', turnId: 't', text: '', phase: null, streaming: true },
      { type: 'command', id: 'c', turnId: 't', command: 'test', cwd: '/', status: 'inProgress', output: '', exitCode: null }
    ] }
  } })
  const sidebar = state.sidebar
  for (let i = 0; i < 100; i++) {
    for (const [itemId, field] of [['a', 'text'], ['c', 'output']] as const) {
      state = reduceChatRendererEvent(state, { type: 'pane', paneId: 'pane-a',
        event: { type: 'itemDelta', itemId, field, delta: 'x' } })
      assert.equal(state.sidebar, sidebar)
    }
  }
  assert.equal(state.workspace.selected.items[0]?.type === 'assistant' && state.workspace.selected.items[0].text, 'x'.repeat(100))
  state = reduceChatRendererEvent(state, { type: 'chats', selectedPaneId: 'pane-a', chats: [] })
  assert.equal(state.sidebar, sidebar)
  state = reduceChatRendererEvent(state, { type: 'pane', paneId: 'pane-a', event: { type: 'turn', turnId: null } })
  assert.equal(state.sidebar, state.workspace.selected)
  assert.notEqual(state.sidebar, sidebar)

  state = reduceChatRendererEvent(state, { type: 'workspace', snapshot: {
    ...initialChatWorkspaceState(), selectedPaneId: 'pane-b'
  } })
  assert.equal(state.sidebar, state.workspace.selected)
  assert.deepEqual(state.sidebar.items, [])
})

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

test('trimMountedHistory drops prepended turns but keeps hasEarlier', () => {
  const items = [
    { type: 'user' as const, id: 'u1', turnId: 't1', text: 'First' },
    { type: 'assistant' as const, id: 'a1', turnId: 't1', text: 'A1', phase: null, streaming: false },
    { type: 'user' as const, id: 'u2', turnId: 't2', text: 'Second' },
    { type: 'assistant' as const, id: 'a2', turnId: 't2', text: 'A2', phase: null, streaming: false }
  ]
  const state = { ...initialChatWorkspaceState(), selectedPaneId: 'pane',
    selected: { ...initialChatState(), threadId: 'thread', items, history: { hasEarlier: false } }
  }
  const next = reduceChatWorkspaceEvent(state, { type: 'trimMountedHistory', paneId: 'pane', threadId: 'thread' })
  assert.deepEqual(next.selected.items.map((item) => item.id), ['u2', 'a2'])
  assert.equal(next.selected.history?.hasEarlier, true)
  assert.equal(reduceChatWorkspaceEvent(next, { type: 'trimMountedHistory', paneId: 'pane', threadId: 'thread' }), next)
})

test('history prepends preserve live updates and reject stale page responses', () => {
  const current = { type: 'user' as const, id: 'new', turnId: null, text: 'current' }
  const state = { ...initialChatWorkspaceState(), selectedPaneId: 'pane',
    selected: { ...initialChatState(), threadId: 'thread', items: [current], history: { hasEarlier: true } }
  }
  const action = { type: 'historyPage' as const, paneId: 'pane', threadId: 'thread', beforeItemId: 'new',
    page: { items: [{ ...current, id: 'old' }, { ...current, text: 'stale copy' }], hasEarlier: false }
  }
  const next = reduceChatWorkspaceEvent(state, action)
  assert.deepEqual(next.selected.items.map((item) => item.id), ['old', 'new'])
  assert.equal(next.selected.items[1], current)
  assert.equal(next.selected.history?.hasEarlier, false)
  assert.equal(reduceChatWorkspaceEvent(next, action), next)
  assert.equal(reduceChatWorkspaceEvent(state, { ...action, threadId: 'other' }), state)
  assert.equal(reduceChatWorkspaceEvent(state, { ...action, paneId: 'other' }), state)
  const late = reduceChatEvent(state.selected, { type: 'item', appended: false, item: { ...current, id: 'unloaded' } })
  assert.equal(late, state.selected)
  assert.deepEqual(state.selected.items, [current])
})

test('unloaded background updates stay in status and merge into a subsequently loaded page', () => {
  const task = { type: 'tool' as const, id: 'task', turnId: 'old', label: 'Agent', detail: 'working',
    status: 'running', background: { taskId: 'task', kind: 'agent' as const } }
  const tail = { type: 'user' as const, id: 'tail', turnId: null, text: 'latest' }
  let selected = { ...initialChatState(), items: [tail], history: { hasEarlier: true, backgroundTasks: [task] } } as ReturnType<typeof initialChatState>
  selected = reduceChatEvent(selected, { type: 'item', appended: false, item: { ...task, status: 'completed' } })
  const state = { ...initialChatWorkspaceState(), selectedPaneId: 'pane', selected }
  const next = reduceChatWorkspaceEvent(state, { type: 'historyPage', paneId: 'pane', threadId: null,
    beforeItemId: 'tail', page: { hasEarlier: false, items: [task] } })
  const loaded = next.selected.items[0]
  assert.ok(loaded?.type === 'tool')
  assert.equal(loaded.status, 'completed')
  assert.deepEqual(next.selected.history?.backgroundTasks, [])
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
  const paged = { ...state, threadName: null, history: { hasEarlier: true, title: 'Original request' } }
  assert.equal(chatTitle(paged), 'Original request')
  assert.equal(chatTitle({ ...paged, history: { hasEarlier: false, title: 'New chat' } }), 'Refactor the composer')
})

test('summarizeMessage truncates long first lines', () => {
  assert.equal(summarizeMessage('a'.repeat(100), 10), 'aaaaaaaaa…')
  assert.equal(summarizeMessage('   \n\n'), 'New chat')
})

test('chat title ignores injected context blocks in the first user message', () => {
  const state = reduceChatEvent(initialChatState(), {
    type: 'item',
    item: {
      type: 'user',
      id: 'u1',
      turnId: null,
      text: '<closedai_context name="closedai.instructions" kind="application">\nrules\n</closedai_context>\nFix conversation naming'
    }
  })
  assert.equal(chatTitle(state), 'Fix conversation naming')
})

test('context usage updates replace the previous reading', () => {
  const usage = { usedTokens: 50_000, contextWindow: 200_000, percent: 25 }
  const state = reduceChatEvent(initialChatState(), { type: 'context', usage })
  assert.deepEqual(state.contextUsage, usage)
  assert.equal(reduceChatEvent(state, { type: 'context', usage: null }).contextUsage, null)
})

test('latest turn context report replaces the previous report', () => {
  const report = {
    createdAt: 1,
    provider: 'codex' as const,
    model: 'gpt-5.6-sol',
    threadId: 'thread-1',
    message: { value: 'hello', characters: 5, estimatedTokens: 2 },
    attachments: [],
    additions: [],
    estimatedAddedTextTokens: 2,
    retainedHistory: 'Native history.'
  }
  const state = reduceChatEvent(initialChatState(), { type: 'turnContext', report })
  assert.deepEqual(state.turnContext, report)
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

test('coalesceChatWorkspaceEvents collapses pane stream chunks and resets on workspace replace', () => {
  const ws = initialChatWorkspaceState()
  const merged = coalesceChatWorkspaceEvents([
    { type: 'pane', paneId: 'p1', event: { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'stale' } },
    { type: 'workspace', snapshot: ws },
    { type: 'pane', paneId: 'p1', event: { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'hel' } },
    { type: 'pane', paneId: 'p1', event: { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'lo' } },
    { type: 'pane', paneId: 'p2', event: { type: 'itemDelta', itemId: 'b', field: 'text', delta: 'world' } }
  ])
  assert.deepEqual(merged, [
    { type: 'workspace', snapshot: ws },
    { type: 'pane', paneId: 'p1', event: { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'hello' } },
    { type: 'pane', paneId: 'p2', event: { type: 'itemDelta', itemId: 'b', field: 'text', delta: 'world' } }
  ])
})

test('a paused turn offers Resume until the next turn starts', () => {
  const idle = reduceChatEvent(initialChatState(), { type: 'turn', turnId: 't1' })
  assert.equal(idle.pausedTurnId, null)
  const ended = reduceChatEvent(reduceChatEvent(idle, { type: 'turn', turnId: null }),
    { type: 'paused', turnId: 't1' })
  assert.equal(ended.pausedTurnId, 't1')
  assert.equal(reduceChatEvent(ended, { type: 'turn', turnId: 't2' }).pausedTurnId, null)
})
