import assert from 'node:assert/strict'
import test from 'node:test'
import { removeId, toggleId } from './agent-fold-state.js'

test('toggleId adds and removes ids purely', () => {
  const initial = new Set<string>()
  const added = toggleId(initial, 'chat-1')
  assert.equal(added.has('chat-1'), true)
  assert.equal(initial.has('chat-1'), false)

  const removed = toggleId(added, 'chat-1')
  assert.equal(removed.has('chat-1'), false)
})

test('removeId removes existing id or returns unchanged set', () => {
  const initial = new Set(['chat-1', 'chat-2'])
  const next = removeId(initial, 'chat-1')
  assert.equal(next.has('chat-1'), false)
  assert.equal(next.has('chat-2'), true)

  const unchanged = removeId(next, 'non-existent')
  assert.equal(unchanged, next)
})
