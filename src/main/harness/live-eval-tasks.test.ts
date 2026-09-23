import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { findLiveEvalTask, formatLiveEvalTask, loadLiveEvalTasks } from './live-eval-tasks.js'

const projectRoot = resolve(import.meta.dirname, '../../..')

test('live eval catalog loads with unique ids and observe lists', async () => {
  const tasks = await loadLiveEvalTasks(projectRoot)
  assert.ok(tasks.length >= 3)
  const ids = new Set<string>()
  for (const task of tasks) {
    assert.ok(task.user.trim())
    assert.ok(task.observe.length)
    assert.ok(!ids.has(task.id))
    ids.add(task.id)
  }
})

test('formatLiveEvalTask includes user text and checklist', async () => {
  const tasks = await loadLiveEvalTasks(projectRoot)
  const task = findLiveEvalTask(tasks, 'workspace_orientation')
  assert.ok(task)
  const text = formatLiveEvalTask(task!)
  assert.match(text, /workspace_orientation/)
  assert.match(text, /closedai_app\.state/)
  assert.match(text, /Observe:/)
})
