import assert from 'node:assert/strict'
import test from 'node:test'
import type { TraceEntry } from '../../shared/trace.js'
import { groupByTurn } from './trace-controller.js'

let seq = 0
function entry(label: string, turnId: string | null, extra: Partial<TraceEntry> = {}): TraceEntry {
  seq += 1
  return { seq, at: 1_000 + seq, paneId: 'p', provider: 'codex', turnId, kind: 'event', label, summary: label, detail: '', truncated: false, ...extra }
}

test('entries without a turn id join the open turn, and the turn end closes it', () => {
  const groups = groupByTurn([
    entry('codex.out', null),
    entry('turn.start', 't1'),
    entry('item.user', 't1'),
    entry('context', null),
    entry('item.assistant', 't1'),
    entry('turn.end', null, { durationMs: 250 }),
    entry('context', null)
  ])
  assert.deepEqual(groups.map((group) => [group.turnId, group.entries.length, group.durationMs]), [
    [null, 1, null],
    ['t1', 5, 250],
    [null, 1, null]
  ])
  assert.equal(groups[0]!.entries[0]!.label, 'context')
})

test('a second turn starts a new group even without a preceding end', () => {
  const groups = groupByTurn([entry('turn.start', 't1'), entry('item.user', 't1'), entry('turn.start', 't2'), entry('item.user', 't2')])
  assert.deepEqual(groups.map((group) => group.turnId), ['t2', 't1'])
})
