import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { currentBackgroundTasks } from './background-tasks.js'

test('completed background work persists until the next user message while active work remains accessible', () => {
  const user: ChatTranscriptItem = { type: 'user', id: 'u1', turnId: 't1', text: 'Start' }
  const task: ChatTranscriptItem = {
    type: 'tool', id: 'b1', turnId: 't1', label: 'Review', detail: '', status: 'completed',
    background: { taskId: 'b1', kind: 'agent' }
  }
  assert.deepEqual(currentBackgroundTasks([user, task]).map((item) => item.id), ['b1'])
  const next: ChatTranscriptItem = { ...user, id: 'u2', turnId: 't2' }
  assert.deepEqual(currentBackgroundTasks([user, task, next]), [])
  assert.deepEqual(currentBackgroundTasks([user, { ...task, status: 'inProgress' }, next]).map((item) => item.id), ['b1'])
})
