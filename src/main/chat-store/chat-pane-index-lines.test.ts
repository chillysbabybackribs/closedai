import assert from 'node:assert/strict'
import test from 'node:test'
import { chatRecord } from '../chat-peers/peer-manager-harness.js'
import { chatPaneCheckpointIndexLines, mergePaneIndexLines } from './chat-pane-index-lines.js'

test('mergePaneIndexLines retains checkpoint facets when transcript exceeds budget', () => {
  const record = chatRecord('p', null, {
    codexThreadId: 't',
    threadId: 't',
    checkpoint: {
      version: 1,
      revision: 1,
      threadId: 't',
      throughItemId: 'u1',
      createdAt: 1,
      state: {
        goal: 'Remember purple buttons',
        constraints: [],
        decisions: [],
        progress: [],
        nextSteps: [],
        files: []
      }
    }
  })
  const long = 'x'.repeat(500)
  const lines = mergePaneIndexLines(
    [{ type: 'user', id: 'u0', turnId: 't', text: long }],
    record,
    200
  )
  assert.ok(lines.some((line) => line.role === 'checkpoint' && line.text.includes('purple buttons')))
  assert.ok(lines.every((line) => line.role === 'checkpoint' || line.text === long))
})

test('chatPaneCheckpointIndexLines includes frozen continuation checkpoint', () => {
  const record = chatRecord('p', null, {
    codexThreadId: 't',
    threadId: 't',
    checkpoint: {
      version: 1,
      revision: 1,
      threadId: 't',
      throughItemId: 'new',
      createdAt: 2,
      state: { goal: 'New goal', constraints: [], decisions: [], progress: [], nextSteps: [], files: [] }
    },
    continuation: {
      sourcePaneId: 'p',
      sourceThreadId: 'old',
      sourceProvider: 'codex',
      sourceTitle: 'Old',
      sourceThroughItemId: 'old-item',
      handoff: null,
      createdAt: 1,
      checkpoint: {
        version: 1,
        revision: 1,
        threadId: 'old',
        throughItemId: 'old-item',
        createdAt: 1,
        state: { goal: 'Frozen goal', constraints: [], decisions: [], progress: [], nextSteps: [], files: [] }
      }
    }
  })
  const goals = chatPaneCheckpointIndexLines(record).filter((line) => line.text.startsWith('Goal:'))
  assert.equal(goals.length, 2)
})
