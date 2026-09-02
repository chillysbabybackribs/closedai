import assert from 'node:assert/strict'
import test from 'node:test'

import type { ChatTranscriptItem } from '../shared/chat.ts'
import { taskActivityLabel } from './task-activity.tsx'

test('task activity is hidden without an active turn', () => {
  assert.equal(taskActivityLabel([], null), '')
})

test('task activity starts with a quiet thinking label', () => {
  assert.equal(taskActivityLabel([
    { type: 'user', id: 'u', turnId: 'turn-1', text: 'Make it horizontal' }
  ], 'turn-1'), 'Thinking')
})

test('task activity describes the latest running operation', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 'turn-1', text: 'Inspect this' },
    {
      type: 'command', id: 'c', turnId: 'turn-1', command: 'bash -lc "rg AGENTS.md"',
      cwd: '/', status: 'inProgress', output: '', exitCode: null
    }
  ]
  assert.equal(taskActivityLabel(items, 'turn-1'), 'Searching for AGENTS.md')
})

test('completed work yields to thinking while the turn remains active', () => {
  const items: ChatTranscriptItem[] = [{
    type: 'tool', id: 't', turnId: 'turn-1', label: 'Web search', detail: '', status: 'completed'
  }]
  assert.equal(taskActivityLabel(items, 'turn-1'), 'Thinking')
})

test('streaming prose and hidden reasoning have distinct safe labels', () => {
  assert.equal(taskActivityLabel([{
    type: 'assistant', id: 'a', turnId: 'turn-1', text: 'Here is', phase: 'final_answer', streaming: true
  }], 'turn-1'), 'Writing response')
  assert.equal(taskActivityLabel([{
    type: 'reasoning', id: 'r', turnId: 'turn-1', text: 'private', streaming: true
  }], 'turn-1'), 'Thinking')
})
