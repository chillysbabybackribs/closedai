import assert from 'node:assert/strict'
import test from 'node:test'
import { ClaudeBackgroundTasks } from './claude-background-tasks.js'
import { ClaudeTurnTranslator } from './claude-stream.js'

test('task lifecycle retains identity and spawning turn across replies and ignores late progress', () => {
  const tasks = new ClaudeBackgroundTasks()
  const start = tasks.handle({ subtype: 'task_started', task_id: 'a', tool_use_id: 'tool', task_type: 'local_agent', description: 'Review adapters' }, 'turn-a')!
  const progress = tasks.handle({ subtype: 'task_progress', task_id: 'a', summary: 'Reading events', usage: { duration_ms: 1234 } }, null)!
  assert.equal(progress.id, start.id)
  assert.equal(progress.turnId, 'turn-a')
  assert.equal(progress.background?.progress, 'Reading events')
  const done = tasks.handle({ subtype: 'task_notification', task_id: 'a', status: 'completed', summary: 'Reviewed' }, 'turn-b')!
  assert.equal(done.turnId, 'turn-a')
  assert.equal(done.background?.kind, 'agent')
  assert.equal(done.output, 'Reviewed')
  assert.equal(tasks.running, false)
  assert.equal(tasks.handle({ subtype: 'task_progress', task_id: 'a' }, null), null)
})

test('housekeeping is hidden and session shutdown settles unfinished tasks', () => {
  const tasks = new ClaudeBackgroundTasks()
  assert.equal(tasks.handle({ subtype: 'task_started', task_id: 'hidden', ambient: true }, null), null)
  assert.equal(tasks.handle({ subtype: 'task_notification', task_id: 'hidden', status: 'completed' }, null), null)
  tasks.handle({ subtype: 'task_started', task_id: 'a' }, 't')
  assert.equal(tasks.running, true)
  assert.equal(tasks.stop()[0]?.status, 'stopped')
  assert.equal(tasks.running, false)
})

test('translator emits updates instead of notices and replay does not invent timestamps', () => {
  const translator = new ClaudeTurnTranslator({ cwd: '/', turnId: 't', displayScreenshot: () => null, replay: true })
  const start = translator.handle({ type: 'system', subtype: 'task_started', task_id: 'a', description: 'Inspect' }).ops[0]
  assert.equal(start?.type, 'item')
  if (start?.type === 'item' && start.item.type === 'tool') assert.equal(start.item.startedAt, undefined)
  const end = translator.handle({ type: 'system', subtype: 'task_notification', task_id: 'a', status: 'failed', summary: 'Failed' }).ops[0]
  assert.equal(end?.type, 'item')
  if (end?.type === 'item' && end.item.type === 'tool') {
    assert.equal(end.item.status, 'failed')
    assert.equal(end.item.finishedAt, undefined)
  }
})
