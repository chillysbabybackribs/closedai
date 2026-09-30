import assert from 'node:assert/strict'
import test from 'node:test'
import { chatRecord } from '../chat-peers/peer-manager-harness.js'
import { ChatPaneLexicalIndex, lexicalQueryTerms, scoreLexicalLineMatch } from './chat-pane-lexical-index.js'

const settings = {
  chatMemoryIndexEnabled: true,
  chatMemoryIndexMaxCharsPerChat: 10_000
}

test('lexicalQueryTerms splits on whitespace', () => {
  assert.deepEqual(lexicalQueryTerms('  foo   BAR  '), ['foo', 'bar'])
})

test('scoreLexicalLineMatch requires every term', () => {
  assert.equal(scoreLexicalLineMatch(['alpha', 'beta'], 'alpha only'), null)
  assert.ok(scoreLexicalLineMatch(['alpha', 'beta'], 'alpha and beta')! > 0)
})

test('ChatPaneLexicalIndex searchPane matches all query terms', () => {
  const index = ChatPaneLexicalIndex.inMemory(settings)
  const record = chatRecord('pane-a', null, { codexThreadId: 't', threadId: 't' })
  index.upsert(record, [
    { type: 'user', id: 'u1', turnId: 't', text: 'Keep purple accent buttons' },
    { type: 'user', id: 'u2', turnId: 't2', text: 'Switch to green theme' }
  ], { rotationEpoch: 0, partial: false })
  const hit = index.searchPane('pane-a', { scope: 'chat', query: 'purple accent' }).hits[0]
  assert.equal(hit?.itemId, 'u1')
  assert.equal(index.searchPane('pane-a', { scope: 'chat', query: 'purple green' }).hits.length, 0)
})

test('ChatPaneLexicalIndex reports rotation epoch and partial flag', () => {
  const index = ChatPaneLexicalIndex.inMemory(settings)
  const record = chatRecord('pane-b', null, { codexThreadId: 't', threadId: 't' })
  index.upsert(record, [{ type: 'user', id: 'u1', turnId: 't', text: 'Before rotation' }], { rotationEpoch: 3, partial: true })
  const result = index.searchPane('pane-b', { scope: 'chat', query: 'rotation' })
  assert.equal(result.rotationEpoch, 3)
  assert.equal(result.indexPartial, true)
})
