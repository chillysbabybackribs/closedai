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

test('composer stays bottom when the pane is paging or replaying a transcript', () => {
  resetComposerLayoutForTests()
  const replaying = { ...empty, threadId: 'codex:t1', history: { hasEarlier: false, backgroundTasks: [] } }
  assert.equal(paneHasTranscript(replaying), false)
  assert.equal(composerAnchoredBottom('pane-a', replaying), false)
  const paged = { ...empty, threadId: 'codex:t1', history: { hasEarlier: true, backgroundTasks: [] } }
  assert.equal(paneHasTranscript(paged), true)
  assert.equal(composerAnchoredBottom('pane-a', paged), true)
})

test('composer recenters for a blank chat', () => {
  resetComposerLayoutForTests()
  composerAnchoredBottom('pane-b', { ...empty, threadId: 'codex:t1' })
  assert.equal(composerAnchoredBottom('pane-b', empty), false)
})

test('drawer title and preview alone do not count as a transcript', () => {
  resetComposerLayoutForTests()
  assert.equal(paneHasTranscript(empty), false)
  assert.equal(composerAnchoredBottom('pane-c', empty), false)
})
