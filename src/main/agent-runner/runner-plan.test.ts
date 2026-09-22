import assert from 'node:assert/strict'
import { test } from 'node:test'

import { defaultHiveConfig, type HiveConfig } from '../../shared/project/coordinator.js'
import type { TaskAssignment, TreeNode, TreeState } from '../../shared/project/tree.js'
import { MAX_TASK_ATTEMPTS, WORKER_GRACE_MS, planRun, type PaneState } from './runner-plan.js'

const NOW = 1_000_000

function task(id: string, state: TreeState, extra: Partial<TreeNode> = {}): TreeNode {
  return {
    id, kind: 'task', state, title: id, summary: '', detail: '',
    createdAt: NOW - 10_000, updatedAt: NOW - 10_000, ...extra
  }
}

function assignment(paneId: string, extra: Partial<TaskAssignment> = {}): TaskAssignment {
  return { paneId, startedAt: NOW - 60_000, activityAt: NOW - 60_000, activity: null, attempts: 1, ...extra }
}

const alive = (running: boolean): PaneState => ({ exists: true, running, activity: null })

function hive(patch: Partial<HiveConfig['workers']> = {}, mode: HiveConfig['dispatch']['mode'] = 'rolling'): HiveConfig {
  const base = defaultHiveConfig()
  return { ...base, workers: { ...base.workers, ...patch }, dispatch: { ...base.dispatch, mode } }
}

test('an empty tree asks the coordinator to plan, a drained one to replan', () => {
  const empty = planRun({ nodes: [], hive: hive(), now: NOW, pane: () => alive(false) })
  assert.equal(empty.coordinator, 'plan')

  const drained = planRun({
    nodes: [task('a', 'complete'), task('b', 'blocked')],
    hive: hive(), now: NOW, pane: () => alive(false)
  })
  assert.equal(drained.coordinator, 'replan')
})

test('queued tasks dispatch up to the worker limit and nothing is asked of the coordinator', () => {
  const plan = planRun({
    nodes: [task('a', 'queued'), task('b', 'queued'), task('c', 'queued')],
    hive: hive({ maxConcurrent: 2 }), now: NOW, pane: () => alive(false)
  })
  assert.deepEqual(plan.dispatch.map((node) => node.id), ['a', 'b'])
  assert.deepEqual(plan.heldBack.map((entry) => entry.node.id), ['c'])
  assert.equal(plan.coordinator, null)
})

test('a queued task whose paths overlap running work waits for it', () => {
  const running = task('a', 'active', { paths: ['src/main'], assignment: assignment('pane-a') })
  const plan = planRun({
    nodes: [running, task('b', 'queued', { paths: ['src/main/chat-hub.ts'] }), task('c', 'queued', { paths: ['src/renderer'] })],
    hive: hive(), now: NOW, pane: () => alive(true)
  })
  assert.deepEqual(plan.carrying.map((node) => node.id), ['a'])
  assert.deepEqual(plan.dispatch.map((node) => node.id), ['c'])
  assert.deepEqual(plan.heldBack.map((entry) => entry.node.id), ['b'])
  assert.match(plan.heldBack[0]!.reason, /src\/main/)
})

test('a task that declares no paths runs beside anything', () => {
  const running = task('a', 'active', { paths: ['docs'], assignment: assignment('pane-a') })
  const plan = planRun({
    nodes: [running, task('b', 'queued')],
    hive: hive(), now: NOW, pane: () => alive(true)
  })
  assert.deepEqual(plan.dispatch.map((node) => node.id), ['b'])
})

test('a worker that just got its brief is left alone until the grace window passes', () => {
  const fresh = task('a', 'active', { assignment: assignment('pane-a', { activityAt: NOW - WORKER_GRACE_MS + 1 }) })
  const plan = planRun({ nodes: [fresh], hive: hive(), now: NOW, pane: () => alive(false) })
  assert.deepEqual(plan.carrying.map((node) => node.id), ['a'])
  assert.deepEqual(plan.settle, [])
})

test('a stopped worker is nudged once, then the task is blocked', () => {
  const stalled = task('a', 'active', { assignment: assignment('pane-a') })
  const first = planRun({ nodes: [stalled], hive: hive(), now: NOW, pane: () => alive(false) })
  assert.equal(first.settle[0]?.outcome, 'nudge')
  // A nudged worker still holds its slot, so nothing else starts in its place.
  assert.equal(first.dispatch.length, 0)

  const exhausted = task('a', 'active', { assignment: assignment('pane-a', { attempts: MAX_TASK_ATTEMPTS }) })
  const second = planRun({ nodes: [exhausted], hive: hive(), now: NOW, pane: () => alive(false) })
  assert.equal(second.settle[0]?.outcome, 'block')
})

test('a task whose worker chat is gone is blocked without a nudge', () => {
  const orphan = task('a', 'active', { assignment: assignment('pane-gone') })
  const plan = planRun({
    nodes: [orphan], hive: hive(), now: NOW,
    pane: () => ({ exists: false, running: false, activity: null })
  })
  assert.equal(plan.settle[0]?.outcome, 'block')
  assert.match(plan.settle[0]!.reason, /worker chat is gone/)
})

test('pausing starts nothing, settles nothing, and asks the coordinator for nothing', () => {
  const plan = planRun({
    nodes: [task('a', 'active', { assignment: assignment('pane-a') }), task('b', 'queued')],
    hive: hive({}, 'paused'), now: NOW, pane: () => alive(false)
  })
  assert.deepEqual(plan.dispatch, [])
  assert.deepEqual(plan.settle, [])
  assert.equal(plan.coordinator, null)
  assert.match(plan.idle ?? '', /paused/)
})
