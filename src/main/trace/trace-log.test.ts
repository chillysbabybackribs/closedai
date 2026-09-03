import assert from 'node:assert/strict'
import test from 'node:test'
import type { TraceEvent } from '../../shared/trace.js'
import { MAX_DETAIL_CHARS, MAX_ENTRIES, providerOfTurn, serialize, TraceLog } from './trace-log.js'
import { summarizeClaudeMessage, summarizeCodexRpc, summarizeAntigravityEvent } from './summaries.js'

const scope = { paneId: 'pane-1', provider: 'codex' as const, turnId: 'turn-1' }

test('records entries in order with serialized detail and emits each one', () => {
  const log = new TraceLog()
  const seen: TraceEvent[] = []
  log.on('event', (event: TraceEvent) => seen.push(event))
  const first = log.record(scope, { kind: 'raw', label: 'codex.out', summary: 'turn/start', detail: { method: 'turn/start' }, direction: 'out' })
  const second = log.record(scope, { kind: 'tool', label: 'tool.result', summary: 'browser.read_page', detail: 'text', durationMs: 12.6, ok: true })
  assert.equal(first.seq, 1)
  assert.equal(second.seq, 2)
  assert.equal(first.detail, JSON.stringify({ method: 'turn/start' }, null, 2))
  assert.equal(second.detail, 'text')
  assert.equal(second.durationMs, 13)
  assert.equal(second.ok, true)
  assert.equal(seen.length, 2)
  assert.deepEqual(log.snapshot().entries.map((entry) => entry.seq), [1, 2])
})

test('caps detail per entry and marks it truncated', () => {
  const big = 'x'.repeat(MAX_DETAIL_CHARS + 100)
  const { text, truncated } = serialize(big)
  assert.equal(truncated, true)
  assert.ok(text.length < big.length)
  assert.ok(text.includes('truncated by the trace'))
  assert.equal(serialize({ a: 1 }).truncated, false)
})

test('evicts the oldest entries past the capacity and counts them as dropped', () => {
  const log = new TraceLog()
  for (let index = 0; index < MAX_ENTRIES + 5; index += 1) {
    log.record(scope, { kind: 'event', label: 'item', summary: String(index), detail: index })
  }
  const snapshot = log.snapshot()
  assert.equal(snapshot.entries.length, MAX_ENTRIES)
  assert.equal(snapshot.dropped, 5)
  assert.equal(snapshot.entries[0]!.summary, '5')
})

test('turn end carries the duration since the matching start on the same pane', async () => {
  const log = new TraceLog()
  log.noteTurn('pane-1', 'claude', 'claude-turn-1')
  await new Promise((resolve) => setTimeout(resolve, 5))
  log.noteTurn('pane-1', 'claude', null)
  const [start, end] = log.snapshot().entries
  assert.equal(start!.label, 'turn.start')
  assert.equal(end!.label, 'turn.end')
  assert.ok((end!.durationMs ?? 0) >= 4)
  assert.equal(end!.turnId, null)
})

test('clear empties the ring and announces it', () => {
  const log = new TraceLog()
  log.record(scope, { kind: 'event', label: 'item', summary: 'a', detail: null })
  const seen: TraceEvent[] = []
  log.on('event', (event: TraceEvent) => seen.push(event))
  log.clear()
  assert.equal(log.snapshot().entries.length, 0)
  assert.deepEqual(seen, [{ type: 'cleared' }])
})

test('outgoing provider traces dispatch first-text timing and clear invalidates pending measurements', () => {
  const log = new TraceLog()
  log.responses.begin(scope)
  log.record(scope, { kind: 'raw', label: 'codex.out', summary: 'turn/start #1', direction: 'out', detail: {} })
  log.responses.event('pane-1', { type: 'item', item: {
    type: 'assistant', id: 'answer', turnId: 'turn-1', text: 'Hello', phase: 'commentary', streaming: true
  } })
  const timing = log.snapshot().entries.at(-1)!
  assert.equal(timing.label, 'response.first_text')
  assert.equal(timing.turnId, 'turn-1')
  assert.ok(timing.durationMs! >= 0)
  log.clear()
  log.responses.event('pane-1', { type: 'turn', turnId: null })
  assert.equal(log.snapshot().entries.length, 0)
  assert.ok(log.responses.begin(scope))
})

test('provider is read from the turn id prefix', () => {
  assert.equal(providerOfTurn('claude-turn-x'), 'claude')
  assert.equal(providerOfTurn('agy-turn-x'), 'antigravity')
  assert.equal(providerOfTurn('01a06356-66fd'), 'codex')
  assert.equal(providerOfTurn(null), null)
})

test('summaries name the method, message parts, and step without the payload', () => {
  assert.equal(summarizeCodexRpc({ id: 3, method: 'turn/start', params: {} }), 'turn/start #3')
  assert.equal(summarizeCodexRpc({ method: 'item/completed', params: { item: { type: 'agentMessage' } } }), 'item/completed · agentMessage')
  assert.equal(summarizeCodexRpc({ id: 3, error: { message: 'boom' } }), 'error #3 boom')
  assert.equal(summarizeCodexRpc({ id: 3, result: {} }), 'response #3')
  const assistant = { type: 'assistant', message: { content: [{ type: 'text' }, { type: 'tool_use', name: 'Read' }], stop_reason: 'tool_use' } }
  assert.equal(summarizeClaudeMessage(assistant as never), 'assistant · text, tool_use Read · stop tool_use')
  assert.equal(summarizeClaudeMessage({ type: 'result', subtype: 'success', total_cost_usd: 0.01234 } as never), 'result success · $0.0123')
  assert.equal(summarizeAntigravityEvent({ event: 'step_update', step_type: 'tool', state: 'DONE', tool_info: { name: 'run_command' } }), 'step tool DONE · run_command')
})
