import assert from 'node:assert/strict'
import test from 'node:test'
import { CursorTurnTranslator, cursorTurnEnd, type TranscriptOp } from './cursor-stream.ts'

// Update shapes taken verbatim from live ACP traffic (cursor-agent 2026.09.02-c22c1a3).

function translator(turnId: string | null = 'cursor-turn-1'): CursorTurnTranslator {
  return new CursorTurnTranslator({ turnId, seed: turnId ?? 'session-1', cwd: '/repo' })
}

function apply(instance: CursorTurnTranslator, updates: unknown[]): TranscriptOp[] {
  return updates.flatMap((update) => instance.handle({ sessionId: 's', update }).ops)
}

test('assistant chunks open one item and stream as deltas', () => {
  const instance = translator()
  const ops = apply(instance, [
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hel' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } }
  ])
  assert.equal(ops.length, 2)
  assert.equal(ops[0]?.type, 'item')
  assert.deepEqual(ops[1], { type: 'delta', itemId: 'cursor-turn-1:t1', field: 'text', delta: 'lo' })
  const [closed] = instance.finish()
  assert.equal(closed?.type === 'item' && closed.item.type === 'assistant' && closed.item.text, 'Hello')
})

test('thinking and answer text do not share an item', () => {
  const ops = apply(translator(), [
    { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'weighing' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } }
  ])
  const items = ops.flatMap((op) => (op.type === 'item' ? [op.item] : []))
  assert.deepEqual(items.map((item) => item.type), ['reasoning', 'reasoning', 'assistant'])
})

test('a shell call becomes a command row and settles with its output', () => {
  const instance = translator()
  const ops = apply(instance, [
    { sessionUpdate: 'tool_call', toolCallId: 'c1', title: '`echo hi`', kind: 'execute', status: 'pending', rawInput: {} },
    { sessionUpdate: 'tool_call_update', toolCallId: 'c1', rawInput: { command: 'echo hi' }, status: 'in_progress' },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'c1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'hi' } }]
    }
  ])
  const items = ops.flatMap((op) => (op.type === 'item' ? [op.item] : []))
  const settled = items.at(-1)
  assert.equal(settled?.type, 'command')
  if (settled?.type !== 'command') return
  assert.equal(settled.command, 'echo hi')
  assert.equal(settled.cwd, '/repo')
  assert.equal(settled.status, 'completed')
  assert.equal(settled.output, 'hi')
  assert.equal(settled.exitCode, 0)
})

test('an edit carrying a diff block becomes a file change', () => {
  const ops = apply(translator(), [
    { sessionUpdate: 'tool_call', toolCallId: 'e1', title: 'Edit a.ts', kind: 'edit', status: 'pending', rawInput: { path: '/repo/a.ts' } },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'e1',
      status: 'completed',
      content: [{ type: 'diff', path: '/repo/a.ts', oldText: 'before', newText: 'after' }]
    }
  ])
  const settled = ops.flatMap((op) => (op.type === 'item' ? [op.item] : [])).at(-1)
  assert.equal(settled?.type, 'fileChange')
  if (settled?.type !== 'fileChange') return
  assert.deepEqual(settled.changes, [{ path: '/repo/a.ts', kind: 'update', diff: '-before\n+after' }])
})

test('a tool still running when the turn ends is closed as failed', () => {
  const instance = translator()
  apply(instance, [{ sessionUpdate: 'tool_call', toolCallId: 'x', title: 'Read', kind: 'read', status: 'in_progress', rawInput: {} }])
  const closed = instance.finish().flatMap((op) => (op.type === 'item' ? [op.item] : []))
  assert.equal(closed[0]?.type === 'tool' && closed[0].status, 'failed')
})

test('a replay turns user chunks into user items with no turn of their own', () => {
  const instance = translator(null)
  const ops = apply(instance, [
    { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hi there' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } }
  ])
  const items = [...ops, ...instance.finish()].flatMap((op) => (op.type === 'item' ? [op.item] : []))
  assert.deepEqual(items.map((item) => item.type), ['user', 'user', 'assistant', 'assistant'])
  assert.equal(items[0]?.turnId, null)
  assert.ok(items[0]?.id.startsWith('session-1:'))
})

test('the title and plan updates are surfaced, and unknown kinds are ignored', () => {
  const instance = translator()
  assert.equal(instance.handle({ update: { sessionUpdate: 'session_info_update', title: 'Apple Echo' } }).title, 'Apple Echo')
  assert.deepEqual(instance.handle({ update: { sessionUpdate: 'available_commands_update', availableCommands: [] } }).ops, [])
  const plan = instance.handle({
    update: { sessionUpdate: 'plan', entries: [{ content: 'step one', status: 'completed' }, { content: 'step two', status: 'in_progress' }] }
  }).ops
  const item = plan.flatMap((op) => (op.type === 'item' ? [op.item] : [])).at(-1)
  assert.equal(item?.type === 'plan' && item.text, '- [x] step one\n- [ ] step two _(in progress)_')
})

test('stop reasons map to the transcript vocabulary', () => {
  assert.deepEqual(cursorTurnEnd('end_turn'), { status: 'completed' })
  assert.deepEqual(cursorTurnEnd('cancelled'), { status: 'interrupted' })
  assert.equal(cursorTurnEnd('refusal').status, 'failed')
})
