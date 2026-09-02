import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../shared/chat.ts'
import { hasReasoningForTurn, transcriptRows } from './chat-transcript.tsx'

test('tool activity in one turn becomes one updating transcript row', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Make the change' },
    {
      type: 'command', id: 'c1', turnId: 't1', command: 'npm install', cwd: '/workspace',
      status: 'completed', output: '', exitCode: 0
    },
    {
      type: 'assistant', id: 'a1', turnId: 't1', text: 'Checking compatibility.',
      phase: 'commentary', streaming: false
    },
    { type: 'fileChange', id: 'f1', turnId: 't1', status: 'completed', changes: [] },
    {
      type: 'command', id: 'c2', turnId: 't1', command: 'npm test', cwd: '/workspace',
      status: 'inProgress', output: '', exitCode: null
    }
  ]
  const rows = transcriptRows(items)
  assert.deepEqual(rows.map((row) => row.kind), ['item', 'activity', 'item'])
  const activity = rows[1]
  assert.equal(activity?.kind, 'activity')
  if (activity?.kind === 'activity') assert.deepEqual(activity.items.map((item) => item.id), ['c1', 'f1', 'c2'])
})

test('tool activity never consolidates across turns or unowned items', () => {
  const command = (id: string, turnId: string | null): ChatTranscriptItem => ({
    type: 'command', id, turnId, command: id, cwd: '/', status: 'completed', output: '', exitCode: 0
  })
  const rows = transcriptRows([command('a', 'turn-a'), command('b', 'turn-b'), command('loose-1', null), command('loose-2', null)])
  assert.deepEqual(rows.map((row) => row.kind === 'activity' ? row.items.map((item) => item.id) : []), [
    ['a'], ['b'], ['loose-1'], ['loose-2']
  ])
})

test('reasoning in one turn becomes one updating transcript row', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'reasoning', id: 'r1', turnId: 'turn-a', text: 'First thought' },
    {
      type: 'assistant', id: 'a1', turnId: 'turn-a', text: 'Progress update',
      phase: 'commentary', streaming: false
    },
    { type: 'reasoning', id: 'r2', turnId: 'turn-a', text: 'Second thought' },
    { type: 'plan', id: 'p1', turnId: 'turn-a', text: 'Implementation plan' }
  ]

  const rows = transcriptRows(items)
  assert.deepEqual(rows.map((row) => row.kind), ['reasoning', 'item'])
  const reasoning = rows[0]
  assert.equal(reasoning?.kind, 'reasoning')
  if (reasoning?.kind === 'reasoning') {
    assert.deepEqual(reasoning.items.map((item) => item.id), ['r1', 'r2', 'p1'])
  }
  assert.equal(hasReasoningForTurn(items, 'turn-a'), true)
  assert.equal(hasReasoningForTurn(items, 'turn-b'), false)
})
