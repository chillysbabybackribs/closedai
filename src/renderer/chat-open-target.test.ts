import assert from 'node:assert/strict'
import test from 'node:test'
import { threadOpensInPlace } from './chat-open-target.js'

const user = { type: 'user' as const, id: 'u1', turnId: 't1', text: 'hello' }

test('only a blank pane takes a history thread in place', () => {
  assert.equal(threadOpensInPlace({ threadId: null, items: [], activeTurnId: null }), true)
})

test('a pane with a conversation, pending items, or a running turn keeps its chat', () => {
  assert.equal(threadOpensInPlace({ threadId: 'codex:t1', items: [], activeTurnId: null }), false)
  assert.equal(threadOpensInPlace({ threadId: null, items: [user], activeTurnId: null }), false)
  assert.equal(threadOpensInPlace({ threadId: null, items: [], activeTurnId: 'turn-1' }), false)
})
