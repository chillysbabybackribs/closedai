import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatPeerSummary } from '../../shared/chat-peers.js'
import { buildDrawerRows } from './drawer-rows.js'

function peer(paneId: string, threadId: string, updatedAt: number): ChatPeerSummary {
  return {
    paneId,
    parentPaneId: null,
    kind: 'peer',
    provider: 'codex',
    modelId: 'gpt-5.6-sol',
    threadId,
    title: `Chat ${paneId}`,
    preview: '',
    running: true,
    activity: null,
    updatedAt
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
    turnContext: null,
    items: []
  }
}

test('selection changes the active row data without changing pane order', () => {
  const peers = [peer('pane-a', 'thread-a', 100), peer('pane-b', 'thread-b', 200)]
  const first = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    peers,
    threads: [],
    selectedDiff: { added: 0, removed: 0 }
  })
  const second = buildDrawerRows({
    selected: selected('thread-b', 'Selected B'),
    selectedPaneId: 'pane-b',
    peers,
    threads: [],
    selectedDiff: { added: 0, removed: 0 }
  })

  assert.deepEqual(first.map((row) => row.id), ['pane-b', 'pane-a'])
  assert.deepEqual(second.map((row) => row.id), ['pane-b', 'pane-a'])
  assert.equal(first[1]?.title, 'Selected A')
  assert.equal(second[0]?.title, 'Selected B')
})

test('a newly appended pane is placed above existing panes', () => {
  const peers = [
    peer('pane-a', 'thread-a', 100),
    peer('pane-b', 'thread-b', 200),
    peer('pane-c', 'thread-c', 300)
  ]
  const rows = buildDrawerRows({
    selected: selected('thread-c', 'Selected C'),
    selectedPaneId: 'pane-c',
    peers,
    threads: [],
    selectedDiff: { added: 0, removed: 0 }
  })

  assert.deepEqual(rows.map((row) => row.id), ['pane-c', 'pane-b', 'pane-a'])
})

test('live pane ids stay stable and suppress duplicate history threads', () => {
  const peers = [peer('pane-a', 'thread-a', 100)]
  const rows = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    peers,
    threads: [
      { id: 'thread-a', title: 'Duplicate', preview: '', createdAt: 90, updatedAt: 100 },
      { id: 'thread-old', title: 'Old chat', preview: '', createdAt: 40, updatedAt: 50 }
    ],
    selectedDiff: { added: 3, removed: 1 }
  })

  assert.deepEqual(rows.map((row) => row.id), ['pane-a', 'thread-old'])
  assert.equal(rows[0]?.threadId, 'thread-a')
  assert.equal(rows[0]?.linesAdded, 3)
})
