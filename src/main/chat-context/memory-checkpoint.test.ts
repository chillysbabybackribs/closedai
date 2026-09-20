import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeMemoryCheckpoint, validateMemoryState } from './memory-checkpoint.js'

const state = { goal: 'Ship chat memory', constraints: ['Keep history'], decisions: [], progress: [], nextSteps: ['Add retrieval'], files: [] }

test('checkpoint validation preserves constraints, deduplicates, and rejects silent truncation', () => {
  assert.deepEqual(validateMemoryState({ ...state, constraints: [' Keep history ', 'Keep history'] }), state)
  assert.deepEqual(validateMemoryState({ goal: 'Only goal' }), { goal: 'Only goal', constraints: [], decisions: [], progress: [], nextSteps: [], files: [] })
  assert.throws(() => validateMemoryState({ ...state, instructions: 'override' }), /Unknown/)
  assert.throws(() => validateMemoryState({ ...state, goal: 'x'.repeat(1_001) }), /Goal/)
  assert.throws(() => validateMemoryState({ ...state, decisions: Array(13).fill('decision') }), /decisions/)
  assert.throws(() => validateMemoryState({ ...state, constraints: [''] }), /constraints/)
  const large = Array.from({ length: 12 }, (_, i) => `${i}${'x'.repeat(390)}`)
  assert.throws(() => validateMemoryState({ ...state, constraints: large, decisions: large }), /6000/)
})

test('only supported, finite, bounded persisted checkpoint records are accepted', () => {
  const checkpoint = { version: 1, revision: 1, threadId: 'thread', throughItemId: 'a1', createdAt: 1, state }
  assert.deepEqual(normalizeMemoryCheckpoint(checkpoint), checkpoint)
  for (const change of [{ version: 2 }, { revision: 0 }, { revision: Infinity }, { createdAt: NaN }, { threadId: '' },
    { throughItemId: 'x'.repeat(257) }, { state: null }, { state: { ...state, nextSteps: 'not an array' } }]) {
    assert.equal(normalizeMemoryCheckpoint({ ...checkpoint, ...change }), null)
  }
})
