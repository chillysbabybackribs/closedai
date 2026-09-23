import assert from 'node:assert/strict'
import test from 'node:test'

import { closesHistoryOnSearchEscape } from './chat-history.js'

function escapeEvent(overrides: {
  key?: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
} = {}) {
  return closesHistoryOnSearchEscape({
    key: overrides.key ?? 'Escape',
    altKey: overrides.altKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    nativeEvent: { isComposing: overrides.isComposing ?? false } as KeyboardEvent
  })
}

test('Escape in chat history search closes the panel', () => {
  assert.equal(escapeEvent(), true)
  assert.equal(escapeEvent({ key: 'Enter' }), false)
  assert.equal(escapeEvent({ isComposing: true }), false)
  assert.equal(escapeEvent({ ctrlKey: true }), false)
  assert.equal(escapeEvent({ shiftKey: true }), false)
})
