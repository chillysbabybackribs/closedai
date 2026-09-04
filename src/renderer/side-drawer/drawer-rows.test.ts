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
    planUsage: null,
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

test('a cold pane names itself from the thread catalog and reads as done, not a blank chat', () => {
  const cold = { ...peer('pane-cold', 'thread-cold', 100), title: 'New chat', running: false }
  const rows = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    peers: [peer('pane-a', 'thread-a', 100), cold],
    threads: [{ id: 'thread-cold', title: 'Catalog title', preview: '', createdAt: 1, updatedAt: 2 }],
    selectedDiff: { added: 0, removed: 0 }
  })

  const coldRow = rows.find((row) => row.id === 'pane-cold')
  assert.equal(coldRow?.title, 'Catalog title')
  assert.equal(coldRow?.status, 'done')
  // The catalog row is folded into the pane row rather than listed twice.
  assert.deepEqual(rows.map((row) => row.id), ['pane-cold', 'pane-a'])
})

test('an idle pane is done regardless of which item came last; a blank pane is a chat', () => {
  const idle = { ...peer('pane-idle', 'thread-idle', 100), running: false, activity: null }
  const blank = { ...peer('pane-blank', 'thread-blank', 100), threadId: null, running: false, title: 'New chat' }
  const rows = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    peers: [peer('pane-a', 'thread-a', 100), idle, blank],
    threads: [],
    selectedDiff: { added: 0, removed: 0 }
  })
  assert.equal(rows.find((row) => row.id === 'pane-idle')?.status, 'done')
  assert.equal(rows.find((row) => row.id === 'pane-blank')?.status, 'chat')
})

test('a history record carries the provider its thread id names, including unprefixed Codex ids', () => {
  const rows = buildDrawerRows({
    selected: selected('thread-a', 'Selected A'),
    selectedPaneId: 'pane-a',
    peers: [peer('pane-a', 'thread-a', 100)],
    threads: [
      { id: '01a06a2b-c42c-7722-9c4f-96416f3878a4', title: 'Codex chat', preview: '', createdAt: 1, updatedAt: 2 },
      { id: 'claude:s1', title: 'Claude chat', preview: '', createdAt: 1, updatedAt: 3 },
      { id: 'agy:c1', title: 'Antigravity chat', preview: '', createdAt: 1, updatedAt: 4 }
    ],
    selectedDiff: { added: 0, removed: 0 }
  })

  assert.deepEqual(
    rows.filter((row) => row.paneId === undefined).map((row) => row.provider),
    ['codex', 'claude', 'antigravity']
  )
})
