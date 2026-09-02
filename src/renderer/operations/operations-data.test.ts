import assert from 'node:assert/strict'
import test from 'node:test'
import { filterRuns, INITIAL_RUNS, workspaceTone } from './operations-data.js'

test('filters attention runs to both approval and failure states', () => {
  assert.deepEqual(
    filterRuns(INITIAL_RUNS, 'attention', '').map((run) => run.status),
    ['attention', 'failed']
  )
})

test('searches task, worker, workspace, and checkpoint text case-insensitively', () => {
  assert.deepEqual(filterRuns(INITIAL_RUNS, 'all', 'VERIFICATION').map((run) => run.id), [1])
  assert.deepEqual(filterRuns(INITIAL_RUNS, 'all', 'release operator').map((run) => run.id), [4])
})

test('combines tab and search filters', () => {
  assert.deepEqual(filterRuns(INITIAL_RUNS, 'completed', 'closedai'), [])
})

test('assigns stable workspace tones', () => {
  assert.equal(workspaceTone('closedai'), 'violet')
  assert.equal(workspaceTone('desktop'), 'blue')
  assert.equal(workspaceTone('platform'), 'green')
})
