import assert from 'node:assert/strict'
import test from 'node:test'
import { antigravityEphemeralArgs, codexEphemeralArgs, codexEphemeralOutput, cursorEphemeralArgs } from './ephemeral-request.js'

test('Antigravity and Cursor args carry the prompt, the model, and the requested effort', () => {
  const agyArgs = antigravityEphemeralArgs('agy:gemini-flash', 'Test prompt', 'low')
  assert.ok(agyArgs.includes('--print=Test prompt'))
  assert.ok(agyArgs.includes('--output-format'))
  assert.equal(agyArgs[agyArgs.indexOf('--model') + 1], 'gemini-flash')
  assert.equal(agyArgs[agyArgs.indexOf('--effort') + 1], 'low')
  assert.equal(antigravityEphemeralArgs('agy:gemini-pro', 'x', 'high').at(antigravityEphemeralArgs('agy:gemini-pro', 'x', 'high').indexOf('--effort') + 1), 'high')

  const cursorArgs = cursorEphemeralArgs('cursor:cursor-fast', 'Test prompt')
  assert.ok(cursorArgs.includes('--trust'))
  assert.ok(cursorArgs.includes('--print'))
  assert.equal(cursorArgs[cursorArgs.indexOf('--mode') + 1], 'ask', 'the read-only mode: an ephemeral request never edits')
  assert.equal(cursorArgs[cursorArgs.indexOf('--model') + 1], 'cursor-fast')
  assert.equal(cursorArgs.at(-1), 'Test prompt')
})

test('Codex request is ephemeral, selected-model, isolated from user config and accepts only completed output', () => {
  const args = codexEphemeralArgs('selected-model', '/tmp/instructions.txt', 'low')
  assert.ok(args.includes('--ephemeral'))
  assert.ok(args.includes('--ignore-user-config'))
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only')
  assert.equal(args[args.indexOf('--model') + 1], 'selected-model')
  assert.ok(args.includes('features.shell_tool=false'))
  assert.ok(args.includes('model_reasoning_effort="low"'))
  assert.ok(codexEphemeralArgs('selected-model', '/tmp/instructions.txt', 'high').includes('model_reasoning_effort="high"'))
  const item = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'File Preview Support' } })
  assert.equal(codexEphemeralOutput(item + '\n{"type":"turn.completed"}', 'Title generation'), 'File Preview Support')
  assert.throws(() => codexEphemeralOutput(item, 'Title generation'), /Title generation returned nothing/)
  assert.throws(() => codexEphemeralOutput(item + '\n{"type":"turn.failed"}', 'Title generation'), /Title generation failed/)
})
