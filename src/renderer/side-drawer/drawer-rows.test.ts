import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { buildDrawerRows } from './drawer-rows.js'

function chat(paneId: string, threadId: string | null, updatedAt: number, overrides: Partial<ChatRowSummary> = {}): ChatRowSummary {
  return {
    paneId,
    parentPaneId: null,
    kind: 'peer',
    provider: 'codex',
    modelId: 'gpt-5.6-sol',
    threadId,
    title: `Chat ${paneId}`,
    preview: '',
    cwd: '/workspace',
    createdAt: updatedAt,
    updatedAt,
    attached: true,
    running: true,
    activity: null,
    ...overrides
  }
}

function selected(threadId: string, threadName: string): ChatSnapshot {
  return {
    provider: 'codex',
    connection: { state: 'ready', message: 'Ready' },
    account: null,
    models: [],
    selectedModel: null,
    selectedReasoningEffort: null,
    cwd: '/workspace',
    threadId,
    threadName,
    activeTurnId: 'turn-1',
    contextUsage: null,
    planUsage: null,
    turnContext: null,
    items: []
  }
}

test('selection changes the active row data without changing row order', () => {
  const chats = [chat('pane-a', 'thread-a', 100), chat('pane-b', 'thread-b', 200)]
  const first = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    chats,
    selectedDiff: { added: 0, removed: 0 }
  })
  const second = buildDrawerRows({
    selected: selected('thread-b', 'Selected B'),
    selectedPaneId: 'pane-b',
    chats,
    selectedDiff: { added: 0, removed: 0 }
  })

  assert.deepEqual(first.map((row) => row.id), ['pane-a', 'pane-b'])
  assert.deepEqual(second.map((row) => row.id), ['pane-a', 'pane-b'])
  assert.equal(first[0]?.title, 'Selected A')
  assert.equal(second[1]?.title, 'Selected B')
})

test('every chat is one row under its store id, attached or not', () => {
  const rows = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    chats: [
      chat('pane-a', 'thread-a', 100),
      chat('thread-old', 'thread-old', 50, { attached: false, running: false, title: 'Old chat' })
    ],
    selectedDiff: { added: 3, removed: 1 }
  })

  assert.deepEqual(rows.map((row) => row.id), ['pane-a', 'thread-old'])
  assert.equal(rows[0]?.paneId, 'pane-a')
  assert.equal(rows[0]?.threadId, 'thread-a')
  assert.equal(rows[0]?.linesAdded, 3)
  assert.equal(rows[1]?.paneId, undefined)
  assert.equal(rows[1]?.title, 'Old chat')
  assert.equal(rows[1]?.status, 'done')
})

test('running comes from the chat summary alone, for the selected chat too', () => {
  const idleSelected = chat('pane-a', 'thread-a', 100, { running: false })
  const rows = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    chats: [idleSelected, chat('pane-b', 'thread-b', 200)],
    selectedDiff: { added: 0, removed: 0 }
  })
  assert.equal(rows.find((row) => row.id === 'pane-a')?.running, false)
  assert.equal(rows.find((row) => row.id === 'pane-b')?.running, true)
})

test('an idle chat with a thread is done; a blank chat is a chat', () => {
  const idle = chat('pane-idle', 'thread-idle', 100, { running: false })
  const blank = chat('pane-blank', null, 100, { running: false, title: 'New chat' })
  const rows = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    chats: [chat('pane-a', 'thread-a', 100), idle, blank],
    selectedDiff: { added: 0, removed: 0 }
  })
  assert.equal(rows.find((row) => row.id === 'pane-idle')?.status, 'done')
  assert.equal(rows.find((row) => row.id === 'pane-blank')?.status, 'chat')
  assert.equal(rows.find((row) => row.id === 'pane-blank')?.title, 'New chat')
})

test('rows carry the provider their record names', () => {
  const rows = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    chats: [
      chat('pane-a', 'thread-a', 100),
      chat('claude:s1', 'claude:s1', 3, { attached: false, running: false, provider: 'claude' }),
      chat('agy:c1', 'agy:c1', 4, { attached: false, running: false, provider: 'antigravity' })
    ],
    selectedDiff: { added: 0, removed: 0 }
  })

  assert.deepEqual(rows.map((row) => row.provider), ['codex', 'claude', 'antigravity'])
})

test('a subagent row nests under its parent chat', () => {
  const rows = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    chats: [
      chat('pane-a', 'thread-a', 100),
      chat('sub-1', 'thread-sub', 120, { parentPaneId: 'pane-a', kind: 'subagent', title: '' })
    ],
    selectedDiff: { added: 0, removed: 0 }
  })

  assert.deepEqual(rows.map((row) => row.id), ['pane-a'])
  assert.deepEqual(rows[0]?.children.map((row) => row.id), ['sub-1'])
  assert.equal(rows[0]?.children[0]?.title, 'Subagent task')
})
