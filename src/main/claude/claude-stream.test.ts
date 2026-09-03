import assert from 'node:assert/strict'
import test from 'node:test'
import { ClaudeTurnTranslator, type TranscriptOp } from './claude-stream.js'

// Fixtures follow the shapes recorded from SDK 0.3.258 on 2026-09-02.
const SESSION = '84b3bb74-73ef-4375-bbab-bac679619015'

function translator(turnId: string | null = 'turn-1', replay = false): ClaudeTurnTranslator {
  return new ClaudeTurnTranslator({ turnId, cwd: '/w', displayScreenshot: () => null, replay })
}

function stream(event: Record<string, unknown>): Record<string, unknown> {
  return { type: 'stream_event', event, parent_tool_use_id: null, uuid: 'u', session_id: SESSION }
}

function items(ops: TranscriptOp[]): Array<Record<string, unknown>> {
  return ops.flatMap((op) => (op.type === 'item' ? [op.item as unknown as Record<string, unknown>] : []))
}

test('init yields the session id and model without transcript output', () => {
  const t = translator()
  const result = t.handle({ type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-opus-5[1m]', tools: [] })
  assert.equal(result.sessionId, SESSION)
  assert.equal(result.model, 'claude-opus-5[1m]')
  assert.deepEqual(result.ops, [])
})

test('thinking and text blocks stream as reasoning and assistant items with deltas', () => {
  const t = translator()
  t.handle(stream({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } } }))
  const start = t.handle(stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }))
  assert.deepEqual(items(start.ops)[0], { type: 'reasoning', id: 'turn-1:m1:b0', turnId: 'turn-1', text: '', streaming: true })
  const delta = t.handle(stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan…' } }))
  assert.deepEqual(delta.ops, [{ type: 'delta', itemId: 'turn-1:m1:b0', field: 'text', delta: 'Plan…' }])
  t.handle(stream({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }))
  const stop = t.handle(stream({ type: 'content_block_stop', index: 0 }))
  assert.deepEqual(items(stop.ops)[0], { type: 'reasoning', id: 'turn-1:m1:b0', turnId: 'turn-1', text: 'Plan…', streaming: false })

  t.handle(stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }))
  t.handle(stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'DO' } }))
  t.handle(stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'NE' } }))
  t.handle(stream({ type: 'content_block_stop', index: 1 }))
  // The restated assistant message lands on the streamed ids, never as new items.
  const restated = t.handle({ type: 'assistant', uuid: 'a1', message: { id: 'msg_1', content: [{ type: 'thinking', thinking: 'Plan…' }, { type: 'text', text: 'DONE' }] } })
  assert.deepEqual(items(restated.ops).map((item) => item.id), ['turn-1:m1:b0', 'turn-1:m1:b1'])
  assert.equal(items(restated.ops)[1]!.text, 'DONE')

  const end = t.handle({ type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed', modelUsage: { 'claude-haiku-4-5-20251001': { contextWindow: 200000 }, 'claude-opus-5[1m]': { contextWindow: 1000000 } } })
  assert.deepEqual(end.turnEnd, { status: 'completed' })
  assert.deepEqual(end.contextUsage, { usedTokens: 115, contextWindow: 1000000 })
})

test('context usage picks the resolved model window, not the first entry', () => {
  const t = translator()
  t.handle({ type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-opus-5[1m]' })
  t.handle(stream({ type: 'message_start', message: { usage: { input_tokens: 50 } } }))
  const end = t.handle({ type: 'result', subtype: 'success', modelUsage: { 'claude-haiku-4-5-20251001': { contextWindow: 200000 }, 'claude-opus-5[1m]': { contextWindow: 1000000 } } })
  assert.equal(end.contextUsage?.contextWindow, 1000000)
  const unknown = translator()
  unknown.handle(stream({ type: 'message_start', message: { usage: { input_tokens: 50 } } }))
  const widest = unknown.handle({ type: 'result', subtype: 'success', modelUsage: { a: { contextWindow: 200000 }, b: { contextWindow: 400000 } } })
  assert.equal(widest.contextUsage?.contextWindow, 400000)
})

test('tool calls stream their input as partial json and settle from the tool result', () => {
  const t = translator()
  t.handle(stream({ type: 'message_start', message: { usage: {} } }))
  const start = t.handle(stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } }))
  assert.equal(items(start.ops)[0]!.type, 'command')
  assert.equal(items(start.ops)[0]!.command, '')
  t.handle(stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"ec' } }))
  t.handle(stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ho hi"}' } }))
  const stop = t.handle(stream({ type: 'content_block_stop', index: 0 }))
  assert.equal(items(stop.ops)[0]!.command, 'echo hi')
  // The restated message re-emits the same call idempotently.
  const restated = t.handle({ type: 'assistant', uuid: 'a2', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } }] } })
  assert.equal(items(restated.ops).length, 1)
  assert.equal(items(restated.ops)[0]!.id, 'toolu_1')
  const result = t.handle({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hi\n' }] } })
  const settled = items(result.ops)[0]!
  assert.equal(settled.status, 'completed')
  assert.equal(settled.output, 'hi\n')
  // A late restatement must not regress the settled call.
  const late = t.handle({ type: 'assistant', uuid: 'a2', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } }] } })
  assert.deepEqual(late.ops, [])
})

test('ClosedAI MCP calls keep their namespace label and screenshot results become screenshots', () => {
  const t = new ClaudeTurnTranslator({ turnId: 'turn-1', cwd: '/w', displayScreenshot: (id) => (id === 'toolu_c' ? { dataUrl: 'data:image/png;base64,FULL' } : null) })
  t.handle({ type: 'assistant', uuid: 'a', message: { content: [{ type: 'tool_use', id: 'toolu_c', name: 'mcp__closedai_ui__capture', input: { action: 'browser_page' } }] } })
  const result = t.handle({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_c', content: [{ type: 'text', text: 'Captured\nCapture ID: toolu_c' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'SMALL' } }] }] } })
  assert.deepEqual(items(result.ops)[0], { type: 'screenshot', id: 'toolu_c', turnId: 'turn-1', imageUrl: 'data:image/png;base64,FULL', surface: 'browser_page', caption: 'Captured' })
})

test('a stopped turn is interrupted, not failed; errors carry the most specific message', () => {
  assert.deepEqual(translator().handle({ type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_tools', errors: ['x'] }).turnEnd, { status: 'interrupted' })
  const failed = translator().handle({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['API Error: 500'] })
  assert.deepEqual(failed.turnEnd, { status: 'failed', error: 'API Error: 500' })
  const limited = translator()
  limited.handle({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1788369000 } })
  assert.match(limited.handle({ type: 'result', subtype: 'success', is_error: true, result: 'x' }).turnEnd!.error!, /usage limit reached/)
  const authFailed = translator()
  authFailed.handle({ type: 'assistant', error: 'authentication_failed', message: { content: [] } })
  assert.equal(authFailed.handle({ type: 'result', subtype: 'success', is_error: true }).turnEnd!.error, 'Claude request failed: authentication failed')
  assert.equal(translator().handle({ type: 'result', subtype: 'error_max_turns', is_error: true }).turnEnd!.error, 'Claude turn ended: error_max_turns')
})

test('system notices: compaction, refusal fallback, denied tools, finished tasks', () => {
  const t = translator()
  assert.deepEqual(t.handle({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 1 } }).ops, [{ type: 'notice', text: 'Conversation context compacted', tone: 'info' }])
  assert.match((t.handle({ type: 'system', subtype: 'model_refusal_fallback', original_model: 'claude-fable-5-1', fallback_model: 'claude-opus-5' }).ops[0] as { text: string }).text, /declined/)
  assert.equal((t.handle({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', message: 'no' }).ops[0] as { tone: string }).tone, 'error')
  assert.equal((t.handle({ type: 'system', subtype: 'task_notification', task_id: 'task', status: 'completed', summary: 'done' }).ops[0] as Extract<TranscriptOp, { type: 'item' }>).item.type, 'tool')
  assert.deepEqual(t.handle({ type: 'system', subtype: 'status', status: 'requesting' }).ops, [])
  assert.deepEqual(t.handle({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 5 }).ops, [])
})

test('live user text is ignored, replayed user text opens a turn and strips app context', () => {
  const live = translator()
  assert.deepEqual(live.handle({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } }).ops, [])
  const replay = translator(null, true)
  const first = replay.handle({ type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: '<closedai_context name="x" kind="application">\nstate\n</closedai_context>\nhello' }, { type: 'image', source: {} }] } })
  assert.deepEqual(items(first.ops)[0], { type: 'user', id: 'user:turn:u1', turnId: 'turn:u1', text: 'hello', attachments: [{ id: 'turn:u1:img0', kind: 'image', name: 'Image' }] })
  const answer = replay.handle({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'hi there' }] } })
  assert.deepEqual(items(answer.ops)[0], { type: 'assistant', id: 'turn:u1:a1:t0', turnId: 'turn:u1', text: 'hi there', phase: null, streaming: false })
  const second = replay.handle({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'again' } })
  assert.equal(items(second.ops)[0]!.turnId, 'turn:u2')
  assert.deepEqual(replay.handle({ type: 'user', uuid: 'u3', isSynthetic: true, message: { role: 'user', content: 'synthetic' } }).ops, [])
})
