import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import { conversationSpineTurns } from './conversation-spine.js'
import { spineFromTurns } from './memory-spine.js'

const user = (id: string, text: string, turnId = id): ChatTranscriptItem => ({ type: 'user', id, turnId, text })
const answer = (id: string, turnId: string, text: string): ChatTranscriptItem =>
  ({ type: 'assistant', id, turnId, text, phase: 'final_answer', streaming: false })

test('conversationSpineTurns groups evidence with its turn', () => {
  const items: ChatTranscriptItem[] = [
    user('u1', 'First', 't1'),
    { type: 'tool', id: 'tool1', turnId: 't1', label: 'grep', detail: '', status: 'completed' },
    answer('a1', 't1', 'Done one.'),
    user('u2', 'Second', 't2'),
    { type: 'command', id: 'cmd', turnId: 't2', command: 'npm test', cwd: '/w', status: 'completed', output: 'secret', exitCode: 0 },
    answer('a2', 't2', 'Done two.')
  ]
  const turns = conversationSpineTurns(items)
  assert.equal(turns.length, 2)
  assert.equal(turns[0]!.evidence.length, 1)
  assert.match(turns[0]!.evidence[0]!.text, /tool: grep/)
  assert.equal(turns[1]!.evidence.length, 1)
  assert.doesNotMatch(turns[1]!.evidence[0]!.text, /secret/)
})

test('spineFromTurns pages newest turns first and caps evidence', () => {
  const turns = conversationSpineTurns([
    user('u1', 'One'),
    answer('a1', 'u1', 'A1'),
    user('u2', 'Two'),
    answer('a2', 'u2', 'A2'),
    user('u3', 'Three'),
    answer('a3', 'u3', 'A3')
  ])
  const page = spineFromTurns(turns, {
    threadId: 'thread',
    title: 'Demo',
    cwd: '/w',
    lastActivityAt: 1,
    chatId: 'chat',
    provenance: 'transcript'
  }, { scope: 'history', limit: 2, includeEvidence: true })
  assert.deepEqual(page.turns.map((turn) => turn.user), ['Two', 'Three'])
  assert.equal(page.hasMore, true)
  assert.equal(page.nextBeforeUserItemId, 'u2')
})

test('spineFromTurns rejects an unknown paging cursor', () => {
  const turns = conversationSpineTurns([user('u1', 'One')])
  assert.throws(() => spineFromTurns(turns, {
    threadId: 'thread', title: null, cwd: '/w', lastActivityAt: 1, provenance: 'transcript'
  }, { scope: 'current', beforeUserItemId: 'missing' }), /cursor/)
})

test('spineFromTurns pages to turns its budget dropped instead of skipping them', () => {
  const long = 'x'.repeat(7_000)
  const turns = conversationSpineTurns([
    user('u1', `One ${long}`),
    user('u2', `Two ${long}`),
    user('u3', `Three ${long}`)
  ])
  const meta = { threadId: 'thread', title: null, cwd: '/w', lastActivityAt: 1, provenance: 'transcript' as const }
  const first = spineFromTurns(turns, meta, { scope: 'history', limit: 3 })
  assert.deepEqual(first.turns.map((turn) => turn.userItemId), ['u2', 'u3'])
  assert.equal(first.hasMore, true)
  assert.equal(first.nextBeforeUserItemId, 'u2')
  const second = spineFromTurns(turns, meta, { scope: 'history', limit: 3, beforeUserItemId: 'u2' })
  assert.deepEqual(second.turns.map((turn) => turn.userItemId), ['u1'])
  assert.equal(second.hasMore, false)
})
