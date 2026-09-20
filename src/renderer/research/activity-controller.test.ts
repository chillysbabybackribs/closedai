import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResearchActivity } from '../../shared/web-research.js'
import { applyResearchEvent, currentResearchRuns, describeRuns, mergeBackfill } from './activity-controller.js'

function run(overrides: Partial<ResearchActivity>): ResearchActivity {
  return {
    runId: 'run', paneId: 'pane', threadId: 'thread', turnId: 'turn-1', state: 'running', startedAt: 1,
    queries: ['topic'], completedQueries: 0, pending: 1, counts: { queued: 0, reading: 0, ready: 0, failed: 0 },
    sources: [], errors: [], presentation: { state: 'waiting_for_source' }, ...overrides
  }
}

test('events replace runs by id, ignore other panes, and drop evicted runs', () => {
  const first = run({ runId: 'a', startedAt: 2 })
  let runs = applyResearchEvent([], { type: 'run', run: first }, 'pane')
  runs = applyResearchEvent(runs, { type: 'run', run: run({ runId: 'b', startedAt: 1 }) }, 'pane')
  assert.deepEqual(runs.map((item) => item.runId), ['b', 'a'])
  runs = applyResearchEvent(runs, { type: 'run', run: run({ runId: 'a', startedAt: 2, state: 'completed' }) }, 'pane')
  assert.equal(runs.find((item) => item.runId === 'a')?.state, 'completed')
  assert.equal(runs.length, 2)
  const untouched = applyResearchEvent(runs, { type: 'run', run: run({ runId: 'c', paneId: 'other' }) }, 'pane')
  assert.equal(untouched, runs)
  assert.deepEqual(applyResearchEvent(runs, { type: 'evicted', runId: 'b' }, 'pane').map((item) => item.runId), ['a'])
})

test('a mount backfill never overwrites a newer live event', () => {
  const live = run({ runId: 'a', state: 'completed' })
  const merged = mergeBackfill([run({ runId: 'a' }), run({ runId: 'b', startedAt: 0 })], [live])
  assert.deepEqual(merged.map((item) => [item.runId, item.state]), [['b', 'running'], ['a', 'completed']])
})

test('finished runs stay visible for their turn and running runs always show', () => {
  const runs = [run({ runId: 'old', turnId: 'turn-0', state: 'completed' }), run({ runId: 'done', state: 'completed' }), run({ runId: 'live', turnId: 'turn-0' })]
  assert.deepEqual(currentResearchRuns(runs, ['turn-1', null]).map((item) => item.runId), ['done', 'live'])
  assert.deepEqual(currentResearchRuns(runs, ['turn-2']).map((item) => item.runId), ['live'])
})

test('the strip label summarizes searching and readiness', () => {
  const source = { id: 's', url: 'https://example.com/a', title: 'A', state: 'ready' as const, discoveredBy: ['brave'] }
  const active = run({ queries: ['a', 'b'], completedQueries: 1, counts: { queued: 1, reading: 0, ready: 1, failed: 0 }, sources: [source, { ...source, id: 't', state: 'queued' }] })
  assert.equal(describeRuns([active]), 'Research · 1 searching · 1 of 2 sources ready')
  assert.equal(describeRuns([{ ...active, state: 'completed' }]), 'Research finished · 1 source ready')
  assert.equal(describeRuns([{ ...active, state: 'cancelled' }]), 'Research stopped · 1 source ready')
})
