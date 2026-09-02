import assert from 'node:assert/strict'
import test from 'node:test'

import type { ChatTranscriptItem } from '../shared/chat.ts'
import { taskActivityLabel } from './task-activity.tsx'
import { activityTitle, isActivity } from './transcript-rows.ts'

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
  assert.equal(taskActivityLabel(items, 'turn-1'), 'Working')
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
  }], 'turn-1'), 'Responding')
  assert.equal(taskActivityLabel([{
    type: 'reasoning', id: 'r', turnId: 'turn-1', text: 'private', streaming: true
  }], 'turn-1'), 'Thinking')
})

test('the strip never repeats the headline of the row directly above it', () => {
  // The complaint that prompted this: the strip echoed the activity row verbatim, so the two
  // stacked lines read as one stutter. The strip reports that work continues; the row names it.
  const running: ChatTranscriptItem[] = [
    { type: 'user', id: 'u', turnId: 't', text: 'go' },
    {
      type: 'command', id: 'c', turnId: 't', command: 'bash -lc "rg AGENTS.md"',
      cwd: '/', status: 'inProgress', output: '', exitCode: null
    }
  ]
  const label = taskActivityLabel(running, 't')
  assert.equal(label, 'Working')
  const row = running[1]!
  if (!isActivity(row)) throw new Error('expected the command to be an activity row')
  assert.notEqual(label, activityTitle(row, true))
})

test('no label ends in a period or ellipsis', () => {
  const cases: ChatTranscriptItem[][] = [
    [{ type: 'reasoning', id: 'r', turnId: 't', text: 'x', streaming: true }],
    [{ type: 'assistant', id: 'a', turnId: 't', text: 'x', phase: 'final_answer', streaming: true }],
    [{ type: 'screenshot', id: 's', turnId: 't', imageUrl: '', surface: 'app_window', caption: '' }],
    [{ type: 'tool', id: 'p', turnId: 't', label: 'Edit', detail: '', status: 'pending' }],
    [{ type: 'tool', id: 'g', turnId: 't', label: 'Edit', detail: '', status: 'inProgress' }]
  ]
  for (const items of cases) {
    const label = taskActivityLabel(items, 't')
    assert.ok(label.length > 0, 'expected a label')
    assert.doesNotMatch(label, /[.…]$/, `"${label}" should not end in a period or ellipsis`)
  }
})
