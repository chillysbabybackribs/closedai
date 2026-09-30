import assert from 'node:assert/strict'
import test from 'node:test'
import { chatRecord } from '../chat-peers/peer-manager-harness.js'
import { ChatPaneLexicalIndex, lexicalQueryTerms, scoreLexicalLineMatch } from './chat-pane-lexical-index.js'

const settings = {
  chatMemoryIndexEnabled: true,
  chatMemoryIndexMaxCharsPerChat: 10_000
}

test('lexicalQueryTerms splits on whitespace', async () => {
  assert.deepEqual(lexicalQueryTerms('  foo   BAR  '), ['foo', 'bar'])
})

test('scoreLexicalLineMatch requires every term', async () => {
  assert.equal(scoreLexicalLineMatch(['alpha', 'beta'], 'alpha only'), null)
  assert.ok(scoreLexicalLineMatch(['alpha', 'beta'], 'alpha and beta')! > 0)
})

test('ChatPaneLexicalIndex searchPane matches all query terms', async () => {
  const index = ChatPaneLexicalIndex.inMemory(settings)
  const record = chatRecord('pane-a', null, { codexThreadId: 't', threadId: 't' })
  index.upsert(record, [
    { type: 'user', id: 'u1', turnId: 't', text: 'Keep purple accent buttons' },
    { type: 'user', id: 'u2', turnId: 't2', text: 'Switch to green theme' }
  ], { rotationEpoch: 0, partial: false })
  const hit = (await index.searchPane('pane-a', { scope: 'chat', query: 'purple accent' })).hits[0]
  assert.equal(hit?.itemId, 'u1')
  assert.equal((await index.searchPane('pane-a', { scope: 'chat', query: 'purple green' })).hits.length, 0)
})

test('ChatPaneLexicalIndex searchPane hits checkpoint facets', async () => {
  const index = ChatPaneLexicalIndex.inMemory(settings)
  const record = chatRecord('pane-c', null, {
    codexThreadId: 't',
    threadId: 't',
    checkpoint: {
      version: 1,
      revision: 1,
      threadId: 't',
      throughItemId: 'u1',
      createdAt: 1,
      state: {
        goal: 'Track layout tokens',
        constraints: ['Use design system'],
        decisions: [],
        progress: [],
        nextSteps: [],
        files: []
      }
    }
  })
  index.upsert(record, [{ type: 'user', id: 'u1', turnId: 't', text: 'Unrelated chatter' }], { rotationEpoch: 0, partial: false })
  const hit = (await index.searchPane('pane-c', { scope: 'chat', query: 'design system' })).hits[0]
  assert.equal(hit?.role, 'checkpoint')
  assert.match(hit?.snippet ?? '', /design system/)
})

test('ChatPaneLexicalIndex reports rotation epoch and partial flag', async () => {
  const index = ChatPaneLexicalIndex.inMemory(settings)
  const record = chatRecord('pane-b', null, { codexThreadId: 't', threadId: 't' })
  index.upsert(record, [{ type: 'user', id: 'u1', turnId: 't', text: 'Before rotation' }], { rotationEpoch: 3, partial: true })
  const result = await index.searchPane('pane-b', { scope: 'chat', query: 'rotation' })
  assert.equal(result.rotationEpoch, 3)
  assert.equal(result.indexPartial, true)
})
