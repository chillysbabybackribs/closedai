import assert from 'node:assert/strict'
import test from 'node:test'

import type { ChatTranscriptItem } from './chat.ts'
import { lastTurnStartIndex, tailTurnSlice, turnsBeforeIndex } from './chat-turn-page.ts'

function turn(user: string, assistant: string, index: number): ChatTranscriptItem[] {
  return [
    { type: 'user', id: `u${index}`, turnId: `t${index}`, text: user },
    { type: 'assistant', id: `a${index}`, turnId: `t${index}`, text: assistant, phase: null, streaming: false }
  ]
}

test('lastTurnStartIndex finds the user that opened the active tail turn', () => {
  const items = [...turn('one', 'done', 1), ...turn('two', 'also', 2)]
  assert.equal(lastTurnStartIndex(items), 2)
  assert.equal(lastTurnStartIndex(items, 2), 0)
})

test('turnsBeforeIndex returns one prior turn ending at the cursor', () => {
  const items = [
    ...turn('first', 'answer', 1),
    { type: 'tool' as const, id: 'tool', turnId: 't2', label: 'Run', detail: '', status: 'completed' as const },
    ...turn('second', 'answer', 2)
  ]
  const slice = turnsBeforeIndex(items, 3, 1)
  assert.equal(slice.start, 0)
  assert.equal(slice.end, 3)
  assert.deepEqual(items.slice(slice.start, slice.end).map((item) => item.id), ['u1', 'a1', 'tool'])
})

test('tailTurnSlice keeps only the latest turn by default', () => {
  const items = [...turn('first', 'answer', 1), ...turn('second', 'answer', 2)]
  const slice = tailTurnSlice(items, 1)
  assert.equal(slice.start, 2)
  assert.equal(slice.hasEarlier, true)
  assert.deepEqual(items.slice(slice.start).map((item) => item.id), ['u2', 'a2'])
})
