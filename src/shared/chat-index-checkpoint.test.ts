import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chatIndexLinesFromCheckpoint,
  checkpointIndexItemId,
  checkpointTextForItemId
} from './chat-index-checkpoint.js'
import type { ChatMemoryCheckpoint } from './chat-memory.js'

const checkpoint: ChatMemoryCheckpoint = {
  version: 1,
  revision: 1,
  threadId: 'thread',
  throughItemId: 'u9',
  createdAt: 1,
  state: {
    goal: 'Ship lexical recall',
    constraints: ['No embeddings'],
    decisions: [],
    progress: [],
    nextSteps: ['Test'],
    files: ['docs/tools.md']
  }
}

test('checkpointIndexItemId builds stable synthetic ids', () => {
  assert.equal(checkpointIndexItemId('u9', 'goal'), 'cp.u9.goal')
})

test('chatIndexLinesFromCheckpoint expands goal, lists, and files', () => {
  const lines = chatIndexLinesFromCheckpoint(checkpoint)
  assert.ok(lines.some((line) => line.text.includes('No embeddings')))
  assert.ok(lines.some((line) => line.role === 'checkpoint' && line.text.startsWith('File:')))
})

test('checkpointTextForItemId round-trips indexed facets', () => {
  const id = checkpointIndexItemId('u9', 'constraints.0')
  assert.match(checkpointTextForItemId(checkpoint, id)!, /No embeddings/)
})
