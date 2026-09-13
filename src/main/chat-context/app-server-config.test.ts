import assert from 'node:assert/strict'
import test from 'node:test'
import { appServerConfigArgs } from './app-server-config.ts'

test('a positive auto-compact limit becomes a Codex config override', () => {
  assert.deepEqual(appServerConfigArgs({ chatMidTurnCompactTokens: 100_000, chatSeamlessRotation: false }), ['-c', 'model_auto_compact_token_limit=100000'])
  assert.deepEqual(appServerConfigArgs({ chatMidTurnCompactTokens: 80_000.6, chatSeamlessRotation: false }), ['-c', 'model_auto_compact_token_limit=80001'])
})

test('zero leaves Codex to its own near-limit compaction', () => {
  assert.deepEqual(appServerConfigArgs({ chatMidTurnCompactTokens: 0, chatSeamlessRotation: false }), [])
})

test('seamless rotation skips mid-turn native compact overrides', () => {
  assert.deepEqual(appServerConfigArgs({ chatMidTurnCompactTokens: 100_000, chatSeamlessRotation: true }), [])
})
