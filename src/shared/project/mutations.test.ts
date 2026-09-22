import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyProjectMutation, applyProjectMutations, applyTreeEvent, type PlannedNode } from './mutations.ts'
import { createDefaultProjectStoreFile } from './store-file.ts'

const root: PlannedNode = { id: 'root', kind: 'root', state: 'anchored', title: 'Root', summary: '', detail: '' }
const task: PlannedNode = { id: 't1', parent: 'root', kind: 'task', state: 'queued', title: 'Task', summary: 'queued', detail: '' }

test('start replaces the tree with the root, resets the journal, and stamps the build', () => {
  const file = createDefaultProjectStoreFile(1)
  file.journal = [{ id: 9, at: 1, text: 'stale' }]
  const next = applyProjectMutation(file, { type: 'start', root, note: 'Direction confirmed.' }, 50)
  assert.equal(next.phase, 'building')
  assert.equal(next.discoveryAsking, null)
  assert.equal(next.startedAt, 50)
  assert.equal(next.caughtUpAt, 50)
  assert.deepEqual(next.tree.map((node) => [node.id, node.createdAt]), [['root', 50]])
  assert.deepEqual(next.journal, [{ id: 1, at: 50, text: 'Direction confirmed.' }])
})

test('tree events add, update, remove, and replace; add is idempotent by id', () => {
  let nodes = applyTreeEvent([], { add: root }, 1)
  nodes = applyTreeEvent(nodes, { add: task }, 2)
  nodes = applyTreeEvent(nodes, { add: task }, 3)
  assert.equal(nodes.length, 2)
  nodes = applyTreeEvent(nodes, { update: { id: 't1', state: 'active' } }, 4)
  assert.equal(nodes[1]!.state, 'active')
  assert.equal(nodes[1]!.summary, 'queued', 'unspecified fields are kept')
  assert.equal(nodes[1]!.updatedAt, 4)
  nodes = applyTreeEvent(nodes, { remove: { id: 't1' } }, 5)
  assert.deepEqual(nodes.map((node) => node.id), ['root'])
  nodes = applyTreeEvent(nodes, { replace: [] }, 6)
  assert.equal(nodes.length, 0)
})

test('journal ids continue from the last line and notes ride along with other verbs', () => {
  const file = applyProjectMutations(createDefaultProjectStoreFile(1), [
    { type: 'journal', text: 'one' },
    { type: 'tree', events: [{ add: root }], note: 'two' },
    { type: 'caughtUp', note: 'three' }
  ], 10)
  assert.deepEqual(file.journal.map((line) => [line.id, line.text]), [[1, 'one'], [2, 'two'], [3, 'three']])
  assert.equal(file.caughtUpAt, 10)
  assert.equal(file.tree.length, 1)
})

test('phase complete stamps acceptedAt; leaving complete clears it and resets catch-up', () => {
  let file = applyProjectMutation(createDefaultProjectStoreFile(1), { type: 'phase', phase: 'complete' }, 20)
  assert.equal(file.acceptedAt, 20)
  file = applyProjectMutation(file, { type: 'phase', phase: 'building' }, 30)
  assert.equal(file.acceptedAt, null)
  assert.equal(file.caughtUpAt, 30)
  assert.equal(file.startedAt, 30, 'a build entered without start still gets a start time')
})

test('direction and coordinator verbs write only their fields', () => {
  const base = createDefaultProjectStoreFile(1)
  const direction = { ...base.direction, idea: 'Ship it', user: 'Me' }
  let file = applyProjectMutation(base, { type: 'direction', direction, asking: 'journey' }, 2)
  assert.equal(file.direction.idea, 'Ship it')
  assert.equal(file.discoveryAsking, 'journey')
  assert.equal(file.phase, 'intake')
  file = applyProjectMutation(file, { type: 'coordinator', coordinator: { provider: 'claude', modelId: 'm', reasoningEffort: null, threadId: 't' } }, 3)
  assert.equal(file.coordinator?.threadId, 't')
})
