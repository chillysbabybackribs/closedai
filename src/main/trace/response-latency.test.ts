import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatEvent, ChatProvider } from '../../shared/chat.js'
import type { TraceInput, TraceScope } from './trace-log.js'
import { ResponseLatency } from './response-latency.js'

function harness(provider: ChatProvider = 'codex') {
  let now = 0
  const entries: Array<TraceInput & TraceScope> = []
  const scope: TraceScope = { paneId: 'p', provider, turnId: null }
  const timing = new ResponseLatency((scope, input) => entries.push({ ...scope, ...input }), () => now)
  const cancel = timing.begin(scope)
  const dispatch = (paneId = 'p') => timing.outgoing({ ...scope, paneId }, {
    kind: 'raw', label: provider === 'antigravity' ? 'agy.out' : `${provider}.out`,
    summary: provider === 'codex' ? 'turn/start #42' : provider === 'claude' ? 'user message' : provider === 'cursor' ? 'session/prompt #42' : 'user turn',
    direction: 'out', detail: {}
  })
  return { timing, entries, cancel, dispatch, scope, at: (value: number) => { now = value } }
}

const assistant = (text: string, id = 'answer', turnId = 't'): ChatEvent => ({
  type: 'item', item: { type: 'assistant', id, turnId, text, phase: null, streaming: true }
})

for (const provider of ['codex', 'claude', 'antigravity', 'cursor'] as const) {
  test(`${provider}: measures send to first text, splitting preparation and compaction wait`, () => {
    const h = harness(provider)
    h.at(100)
    const endWait = h.timing.waitForCompaction('p')
    h.at(500)
    endWait()
    endWait() // not counted twice
    h.at(1_000)
    h.dispatch()
    h.timing.event('p', { type: 'turn', turnId: 't' })
    h.at(1_200)
    h.timing.event('p', assistant(''))
    h.timing.event('p', { type: 'itemDelta', itemId: 'answer', field: 'text', delta: ' ' })
    h.at(1_800)
    h.timing.event('p', { type: 'itemDelta', itemId: 'answer', field: 'text', delta: 'Hello' })
    h.at(2_000)
    h.timing.event('p', assistant('Hello again'))
    h.timing.event('p', { type: 'turn', turnId: null })
    assert.equal(h.entries.length, 1)
    assert.equal(h.entries[0]!.label, 'response.first_text')
    assert.equal(h.entries[0]!.turnId, 't')
    assert.equal(h.entries[0]!.provider, provider)
    assert.deepEqual(h.entries[0]!.detail, {
      elapsedMs: 1_800, preparationMs: 1_000, compactionWaitMs: 400, afterDispatchMs: 800,
      measurement: 'main-process receipt; excludes renderer paint; includes commentary'
    })
  })
}

test('ignores history, compaction turns, reasoning, tool output, stale items, and wrong panes', () => {
  const h = harness()
  h.timing.event('p', assistant('Old history', 'old', 'old-turn'))
  h.timing.event('p', { type: 'turn', turnId: 'compact' })
  h.timing.outgoing(h.scope, { kind: 'raw', label: 'codex.out', direction: 'out', summary: 'thread/compact/start #1', detail: {} })
  h.timing.event('p', assistant('Summary', 'summary', 'compact'))
  h.timing.event('p', { type: 'turn', turnId: null })
  assert.equal(h.entries.length, 0)
  h.at(1_000)
  h.dispatch()
  h.timing.event('p', { type: 'turn', turnId: 't' })
  h.timing.event('other', assistant('Wrong pane'))
  h.timing.event('p', assistant('Old update', 'old', 'old-turn'))
  h.timing.event('p', { type: 'item', item: { type: 'reasoning', id: 'reason', turnId: 't', text: 'Thinking', streaming: true } })
  h.timing.event('p', { type: 'itemDelta', itemId: 'reason', field: 'text', delta: 'Thinking more' })
  h.timing.event('p', { type: 'itemDelta', itemId: 'tool', field: 'output', delta: 'result' })
  assert.equal(h.entries.length, 0)
  h.at(2_000)
  h.timing.event('p', assistant('The actual answer'))
  assert.equal(h.entries[0]!.durationMs, 2_000)
})

test('failed or cleared sends cannot leak into later requests, and duplicate sends cannot replace timing', () => {
  const h = harness()
  assert.equal(h.timing.begin(h.scope), null)
  h.cancel!()
  h.at(500)
  h.timing.begin(h.scope)
  h.cancel!() // stale cancellation must not delete the second request
  h.dispatch()
  h.at(1_000)
  h.timing.event('p', assistant('Answer'))
  assert.equal(h.entries[0]!.durationMs, 500)
  h.timing.clear()
  h.timing.event('p', { type: 'turn', turnId: null })
  h.timing.begin(h.scope)
  h.dispatch()
  h.timing.clear()
  h.timing.event('p', assistant('Late answer'))
  assert.equal(h.entries.length, 1)
})

test('turns ending without text report missing text, not a zero-latency response', () => {
  const h = harness()
  h.dispatch()
  h.timing.event('p', { type: 'turn', turnId: 't' })
  h.at(500)
  h.timing.event('p', { type: 'turn', turnId: null })
  assert.equal(h.entries[0]!.label, 'response.no_text')
  assert.equal(h.entries[0]!.durationMs, 500)
  assert.ok(h.timing.begin(h.scope))
})

test('parallel panes retain independent dispatch times', () => {
  const h = harness()
  h.at(100)
  h.timing.begin({ ...h.scope, paneId: 'q' })
  h.dispatch('q')
  h.at(300)
  h.dispatch('p')
  h.at(500)
  h.timing.event('p', assistant('p'))
  h.timing.event('q', assistant('q'))
  assert.deepEqual(h.entries.map((entry) => [entry.paneId, entry.durationMs]), [['p', 500], ['q', 400]])
})
