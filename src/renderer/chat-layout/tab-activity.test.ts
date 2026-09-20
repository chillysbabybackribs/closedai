import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialChatState } from '../chat-state.js'
import { tabActivity } from './tab-activity.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'

const row = (running: boolean) => ({ running, activity: 'Reading files', preview: 'Task' }) as ChatRowSummary

test('running takes precedence over an unread completion and does not infer waiting from prose', () => {
  const snapshot = initialChatState()
  snapshot.activeTurnId = 'current'
  snapshot.items = [{ type: 'assistant', id: 'a', turnId: 'current', text: 'Waiting for your answer', phase: 'commentary', streaming: true }]
  const result = tabActivity(row(true), snapshot, { queuedAt: 1, viewedAt: null })
  assert.equal(result.state, 'working')
  assert.equal(result.label, 'Working')
})

test('paused and connection failures are distinguished from completion', () => {
  const snapshot = initialChatState()
  snapshot.pausedTurnId = 'turn'
  assert.equal(tabActivity(row(false), snapshot).state, 'paused')
  snapshot.pausedTurnId = null
  snapshot.connection = { state: 'error', message: 'Disconnected' }
  assert.equal(tabActivity(row(false), snapshot).state, 'failed')
})

test('review state is shared with the drawer and clears when viewed', () => {
  assert.equal(tabActivity(row(false), undefined, { queuedAt: 1, viewedAt: null }).state, 'unread')
  assert.equal(tabActivity(row(false), undefined, { queuedAt: 1, viewedAt: 2 }).state, 'idle')
  assert.equal(tabActivity(row(false)).state, 'idle')
})

test('an error notice from an older turn does not mark the current turn failed', () => {
  const snapshot = initialChatState()
  snapshot.items = [
    { type: 'notice', id: 'old-error', turnId: 'old', text: 'Old failure', tone: 'error' },
    { type: 'user', id: 'u', turnId: 'new', text: 'New request' },
    { type: 'assistant', id: 'a', turnId: 'new', text: 'Done', phase: 'final_answer', streaming: false }
  ]
  assert.equal(tabActivity(row(false), snapshot).state, 'idle')
})
