import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attentionRunCount,
  filterRuns,
  INITIAL_RUNS,
  OPERATIONS_RUNS_STORAGE_KEY,
  persistOperationsRuns,
  readOperationsRuns,
  workspaceTone
} from './operations-data.js'

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

test('round-trips persisted runs and ignores malformed storage', () => {
  let value: string | null = null
  const storage = {
    getItem: (key: string) => key === OPERATIONS_RUNS_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => { if (key === OPERATIONS_RUNS_STORAGE_KEY) value = next }
  }

  assert.equal(readOperationsRuns(storage), null)
  persistOperationsRuns(storage, INITIAL_RUNS)
  assert.deepEqual(readOperationsRuns(storage), INITIAL_RUNS)
  value = '{"not":"runs"}'
  assert.equal(readOperationsRuns(storage), null)
  value = '[{"id":1}]'
  assert.equal(readOperationsRuns(storage), null)
})

test('counts attention and failed runs for the shared badge', () => {
  assert.equal(attentionRunCount(INITIAL_RUNS), 2)
  assert.equal(attentionRunCount(INITIAL_RUNS.filter((run) => run.status !== 'failed')), 1)
})
