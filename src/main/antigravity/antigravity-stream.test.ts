import assert from 'node:assert/strict'
import test from 'node:test'
import { AntigravityTurnTranslator, type TranscriptOp } from './antigravity-stream.js'

// Fixtures follow the shapes recorded from agy 1.1.24 on 2026-09-02.
const CONVERSATION = 'ddaaaa35-98d3-43b0-ad9b-38c6532cc563'

function translator(takeCallId: (namespace: string, tool: string) => string | null = () => null, screenshot: string | null = null): AntigravityTurnTranslator {
  return new AntigravityTurnTranslator({
    turnId: 'turn-1',
    cwd: '/w',
    servers: [{ server: 'embedded_browser', namespace: 'embedded_browser' }, { server: 'closedai_ui_k9', namespace: 'closedai_ui' }],
    displayScreenshot: () => (screenshot ? { dataUrl: screenshot } : null),
    takeCallId
  })
}

function step(fields: Record<string, unknown>): Record<string, unknown> {
  return { event: 'step_update', step_update: { conversation_id: CONVERSATION, ...fields } }
}

function items(ops: TranscriptOp[]): Array<Record<string, unknown>> {
  return ops.flatMap((op) => (op.type === 'item' ? [op.item as unknown as Record<string, unknown>] : []))
}

test('init yields the conversation id and model without transcript output', () => {
  const result = translator().handle({ event: 'init', conversation_id: CONVERSATION, init: { model: 'gemini-3.8-flash-low', cwd: '/w', tools: [] } })
  assert.equal(result.conversationId, CONVERSATION)
  assert.equal(result.model, 'gemini-3.8-flash-low')
  assert.deepEqual(result.ops, [])
})

test('text streams as one assistant item per step, settled on DONE', () => {
  const t = translator()
  const active = t.handle(step({ step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'The contents' }))
  assert.deepEqual(items(active.ops)[0], { type: 'assistant', id: 'turn-1:s1', turnId: 'turn-1', text: 'The contents', phase: null, streaming: true })
  const done = t.handle(step({ step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: ' are here.\n', usage: { input_tokens: 10 } }))
  assert.deepEqual(done.ops[0], { type: 'delta', itemId: 'turn-1:s1', field: 'text', delta: ' are here.\n' })
  assert.deepEqual(items(done.ops)[0], { type: 'assistant', id: 'turn-1:s1', turnId: 'turn-1', text: 'The contents are here.\n', phase: null, streaming: false })
  // A thinking-only step (usage but no text) has no transcript representation.
  assert.deepEqual(t.handle(step({ step_index: 2, state: 'DONE', step_type: 'agent_response', usage: { thinking_tokens: 5 } })).ops, [])
})

test('native tool steps become command and file-change items with their output', () => {
  const t = translator()
  const started = t.handle(step({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'pwd' } } }))
  assert.deepEqual(items(started.ops)[0], { type: 'command', id: 'turn-1:s2', turnId: 'turn-1', command: 'pwd', cwd: '/w', status: 'inProgress', output: '', exitCode: null })
  const done = t.handle(step({ step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'pwd' }, output: '/w\r\n' } }))
  const command = items(done.ops)[0]!
  assert.equal(command.status, 'completed')
  assert.equal(command.output, '/w\r\n')
  assert.equal(command.exitCode, 0)
  const write = t.handle(step({ step_index: 3, state: 'ACTIVE', step_type: 'tool', tool_name: 'write_to_file', tool_info: { name: 'write_to_file', parameters: { TargetFile: '/w/a.txt' } } }))
  assert.deepEqual(items(write.ops)[0], { type: 'fileChange', id: 'turn-1:s3', turnId: 'turn-1', status: 'inProgress', changes: [{ path: '/w/a.txt', kind: 'add', diff: '' }] })
  const failed = t.handle(step({ step_index: 3, state: 'ERROR', step_type: 'tool', tool_name: 'write_to_file', tool_info: { name: 'write_to_file', parameters: { TargetFile: '/w/a.txt' }, error: { type: 'permission', message: 'denied' } } }))
  assert.equal(items(failed.ops)[0]!.status, 'failed')
  // A settled step reported again must not regress to in-progress.
  assert.deepEqual(t.handle(step({ step_index: 3, state: 'DONE', step_type: 'tool', tool_name: 'write_to_file', tool_info: { name: 'write_to_file', parameters: {} } })).ops, [])
})

test('ClosedAI MCP declarations keep the namespace label, and a held capture becomes a screenshot', () => {
  const t = translator((namespace, tool) => (namespace === 'closedai_ui' && tool === 'capture' ? 'call-9' : null), 'data:image/png;base64,QUJD')
  const page = t.handle(step({ step_index: 4, state: 'ACTIVE', step_type: 'tool', tool_name: 'mcp_embedded_browser_page', tool_info: { name: 'mcp_embedded_browser_page', parameters: { action: 'read' } } }))
  const tool = items(page.ops)[0]!
  assert.equal(tool.type, 'tool')
  assert.equal(tool.label, 'embedded_browser · page')
  const capture = t.handle(step({ step_index: 5, state: 'DONE', step_type: 'tool', tool_name: 'mcp_closedai_ui_k9_capture', tool_info: { name: 'mcp_closedai_ui_k9_capture', parameters: { action: 'browser_page' }, output: 'Captured the page\nmore' } }))
  const rows = items(capture.ops)
  assert.deepEqual(rows[1], { type: 'screenshot', id: 'turn-1:s5', turnId: 'turn-1', imageUrl: 'data:image/png;base64,QUJD', surface: 'browser_page', caption: 'Captured the page' })
})

test('result completes the turn and repairs a final text the deltas came up short on', () => {
  const t = translator()
  t.handle(step({ step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: '\n' }))
  const result = t.handle({ event: 'result', result: { conversation_id: CONVERSATION, status: 'SUCCESS', response: 'PONG\n' } })
  assert.deepEqual(result.turnEnd, { status: 'completed' })
  assert.deepEqual(items(result.ops).at(-1), { type: 'assistant', id: 'turn-1:s1', turnId: 'turn-1', text: 'PONG\n', phase: null, streaming: false })
  const same = translator()
  same.handle(step({ step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'PONG\n' }))
  const noRepair = same.handle({ event: 'result', result: { status: 'SUCCESS', response: 'PONG\n' } })
  assert.deepEqual(items(noRepair.ops).filter((item) => item.type === 'assistant' && item.text !== 'PONG\n'), [])
})

test('a result without any text becomes a notice; failures and cancellations end the turn accordingly', () => {
  const empty = translator().handle({ event: 'result', result: { status: 'SUCCESS', response: '' } })
  assert.deepEqual(empty.ops, [{ type: 'notice', text: 'Antigravity finished the turn without a reply', tone: 'info' }])
  const failed = translator().handle({ event: 'result', result: { status: 'ERROR', error: 'invalid model selection' } })
  assert.deepEqual(failed.turnEnd, { status: 'failed', error: 'invalid model selection' })
  const cancelled = translator().handle({ event: 'result', result: { status: 'CANCELED' } })
  assert.deepEqual(cancelled.turnEnd, { status: 'interrupted' })
})

test('finish closes tools still running when the process dies mid-turn', () => {
  const t = translator()
  t.handle(step({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'view_file', tool_info: { name: 'view_file', parameters: { AbsolutePath: '/w/a' } } }))
  const closed = items(t.finish())
  assert.equal(closed[0]!.status, 'failed')
  assert.deepEqual(t.finish(), [])
})
