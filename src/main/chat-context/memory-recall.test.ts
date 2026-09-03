import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import type { ChatMemoryCheckpoint } from '../../shared/chat-memory.js'
import { recallTranscript } from './memory-recall.js'

const user = (id: string, text: string): ChatTranscriptItem => ({ type: 'user', id, text, turnId: 't' })
const checkpoint: ChatMemoryCheckpoint = {
  version: 1, revision: 1, threadId: 'thread', throughItemId: 'u1', createdAt: 1,
  state: { goal: 'Keep context small', constraints: ['Do not delete history'], decisions: [], progress: [], nextSteps: [], files: [] }
}

test('recall finds old literal evidence, supports exact message offsets, and omits reasoning/images', () => {
  const items: ChatTranscriptItem[] = [
    user('u1', `${'x'.repeat(2_000)}Important constraint${'z'.repeat(2_000)}`),
    { type: 'reasoning', id: 'r', turnId: 't', text: 'Important constraint private', streaming: false },
    { type: 'screenshot', id: 's', turnId: 't', surface: 'app_window', imageUrl: 'data:image/png;base64,AAAA', caption: 'Important constraint' },
    user('u2', 'A recent different topic')
  ]
  const result = recallTranscript(items, 'thread', checkpoint, { scope: 'current', query: 'IMPORTANT CONSTRAINT' }, null)
  assert.equal(result.trust, 'historical-data')
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]!.itemId, 'u1')
  assert.match(result.matches[0]!.text, /Important constraint/)
  assert.equal(result.matches[0]!.offset, 1_840)
  assert.equal(result.matches[0]!.nextOffset, 2_640)
  const next = recallTranscript(items, 'thread', checkpoint, { scope: 'current', itemId: 'u1', offset: 2_640 }, null)
  assert.equal(next.matches[0]!.text, 'z'.repeat(800))
})

test('source boundaries exclude later messages and later checkpoints, and fail closed when missing', () => {
  const items = [user('u1', 'before branch'), user('u2', 'after branch')]
  const result = recallTranscript(items, 'thread', { ...checkpoint, throughItemId: 'u2' }, { scope: 'source' }, 'u1')
  assert.deepEqual(result.matches.map((item) => item.itemId), ['u1'])
  assert.equal(result.checkpoint, null)
  assert.throws(() => recallTranscript(items, 'thread', checkpoint, { scope: 'source' }, 'missing'), /boundary/)
  assert.equal(recallTranscript(items, 'thread', checkpoint, { scope: 'source', itemId: 'u2' }, 'u1').matches.length, 0)
})

test('search pages older results by stable item ids, without rescanning newer matches into the page', () => {
  const items = Array.from({ length: 20 }, (_, i) => user(`u${i}`, `match ${i}`))
  const first = recallTranscript(items, 'thread', null, { scope: 'current', query: 'match', limit: 2 }, null)
  assert.equal(first.nextBeforeItemId, 'u18')
  items.push(user('u20', 'new match'))
  const next = recallTranscript(items, 'thread', null, { scope: 'current', query: 'match', limit: 2, beforeItemId: first.nextBeforeItemId! }, null)
  assert.deepEqual(next.matches.map((item) => item.itemId), ['u17', 'u16'])
  assert.throws(() => recallTranscript(items, 'thread', null, { scope: 'current', beforeItemId: 'missing' }, null), /cursor/)
})

test('escaped output fits the serialized budget and no-match results do not invent evidence', () => {
  const items = Array.from({ length: 1_000 }, (_, i) => user(`u${i}`, '\u0000'.repeat(4_000)))
  const result = recallTranscript(items, 'thread', null, { scope: 'current', limit: 8 }, null)
  assert.ok(JSON.stringify(result).length <= 16_000)
  assert.ok(result.matches.length <= 8)
  assert.equal(result.hasMore, true)
  const missing = recallTranscript(items, 'thread', null, { scope: 'current', query: 'unknown' }, null)
  assert.deepEqual(missing.matches, [])
  assert.equal(missing.hasMore, false)
})
