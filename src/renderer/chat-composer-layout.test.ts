import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatSnapshot } from '../shared/chat.js'
import {
  composerAnchoredBottom,
  paneHasTranscript,
  resetComposerLayoutForTests,
  stabilizePaneSnapshot
} from './chat-composer-layout.js'

const empty: ChatSnapshot = {
  provider: 'codex',
  account: null,
  threadName: null,
  activeTurnId: null,
  connection: { state: 'ready', message: '' },
  items: [],
  models: [],
  selectedModel: null,
  selectedReasoningEffort: null,
  contextUsage: null,
  planUsage: null,
  threadId: null,
  pausedTurnId: null,
  cwd: '/tmp',
  promptSuggestion: null
}

test('stabilizePaneSnapshot keeps items while the same thread reloads empty', () => {
  const previous = {
    ...empty,
    threadId: 'claude:t1',
    items: [{ id: 'u1', type: 'user' as const, text: 'hello', turnId: null }]
  }
  const next = { ...previous, items: [], connection: { state: 'starting' as const, message: 'Starting…' } }
  const stable = stabilizePaneSnapshot(next, previous)
  assert.equal(stable.items.length, 1)
  assert.equal(stable.connection.state, 'starting')
})

test('stabilizePaneSnapshot adopts a new thread without carrying the old transcript', () => {
  const previous = {
    ...empty,
    threadId: 'claude:t1',
    items: [{ id: 'u1', type: 'user' as const, text: 'hello', turnId: null }]
  }
  const next = { ...empty, threadId: 'claude:t2', items: [] }
  assert.equal(stabilizePaneSnapshot(next, previous).items.length, 0)
})

test('composer stays bottom for a history chat before items replay', () => {
  resetComposerLayoutForTests()
  assert.equal(paneHasTranscript(empty, {
    paneId: 'pane-a', parentPaneId: null, kind: 'peer', provider: 'codex', modelId: null,
    threadId: 'codex:t1', title: 'Earlier chat', preview: 'last answer', running: false, activity: null, updatedAt: 0
  }), true)
  assert.equal(composerAnchoredBottom('pane-a', empty, {
    paneId: 'pane-a', parentPaneId: null, kind: 'peer', provider: 'codex', modelId: null,
    threadId: 'codex:t1', title: 'Earlier chat', preview: 'last answer', running: false, activity: null, updatedAt: 0
  }), true)
})

test('composer recenters for a blank chat', () => {
  resetComposerLayoutForTests()
  composerAnchoredBottom('pane-b', { ...empty, threadId: 'codex:t1' }, {
    paneId: 'pane-b', parentPaneId: null, kind: 'peer', provider: 'codex', modelId: null,
    threadId: 'codex:t1', title: 'New chat', preview: '', running: false, activity: null, updatedAt: 0
  })
  assert.equal(composerAnchoredBottom('pane-b', empty, {
    paneId: 'pane-b', parentPaneId: null, kind: 'peer', provider: 'codex', modelId: null,
    threadId: null, title: 'New chat', preview: '', running: false, activity: null, updatedAt: 0
  }), false)
})
