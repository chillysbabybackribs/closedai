import assert from 'node:assert/strict'
import test from 'node:test'
import { appServerConfigArgs } from './app-server-config.ts'

test('a positive auto-compact limit becomes a Codex config override', () => {
  assert.deepEqual(appServerConfigArgs({ chatAutoCompactTokens: 100_000 }), ['-c', 'model_auto_compact_token_limit=100000'])
  assert.deepEqual(appServerConfigArgs({ chatAutoCompactTokens: 80_000.6 }), ['-c', 'model_auto_compact_token_limit=80001'])
})

test('zero leaves Codex to its own near-limit compaction', () => {
  assert.deepEqual(appServerConfigArgs({ chatAutoCompactTokens: 0 }), [])
})
