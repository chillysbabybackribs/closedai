import assert from 'node:assert/strict'
import test from 'node:test'
import { engineeringInstructions } from './engineering-instructions.js'

test('every lane is told that a model pass, not a call, is the unit of cost', () => {
  for (const provider of ['codex', 'claude', 'antigravity'] as const) {
    assert.match(engineeringInstructions(provider), /Cost is counted in model passes/)
  }
})

test('each lane gets the batching mechanics it can actually express', () => {
  assert.match(engineeringInstructions('codex'), /One exec script is one model pass/)
  assert.match(engineeringInstructions('claude'), /one response carrying three Read calls/)
  assert.match(engineeringInstructions('antigravity'), /one tool step per model pass/)
  assert.match(engineeringInstructions('antigravity'), /single run_command/)
})

test('the Claude lane overrides the bypass-permissions preference for Bash', () => {
  const claude = engineeringInstructions('claude')
  assert.match(claude, /Bypass-permissions mode adds a note preferring Bash[^]*does not apply in ClosedAI/)
  assert.match(claude, /keep Bash for work that is genuinely a command/)
})
