import assert from 'node:assert/strict'
import test from 'node:test'

import { closesHistoryOnSearchEscape, HISTORY_PAGE_SIZE, nextHistoryPage } from './chat-history.js'

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

test('History view pages older chats one page at a time and stops at the end', () => {
  assert.equal(nextHistoryPage(HISTORY_PAGE_SIZE, 1000), HISTORY_PAGE_SIZE * 2)
  assert.equal(nextHistoryPage(HISTORY_PAGE_SIZE, 60), 60)
  assert.equal(nextHistoryPage(10, 5), 5)
})
