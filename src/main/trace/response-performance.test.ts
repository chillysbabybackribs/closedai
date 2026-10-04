import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResponseSample } from '../../shared/performance.js'
import { summarizeResponsePerformance } from './response-performance.js'

test('separates baseline modes and averages only observed metrics, including zero', () => {
  const row: ResponseSample = { paneId: 'p', turnId: 't', provider: 'codex', baselineEnabled: true,
    preparationMs: 10, firstTextMs: 100, totalMs: 500, rendererMs: 0 }
  const result = summarizeResponsePerformance([
    row, { ...row, preparationMs: 30, firstTextMs: null, totalMs: null, rendererMs: null },
    { ...row, baselineEnabled: false, rendererMs: 40 }
  ], 200)
  assert.equal(result.samples, 3)
  assert.deepEqual(result.groups[0], { provider: 'codex', baselineEnabled: true, turns: 2, completed: 1,
    rendererSamples: 1, preparationMs: 20, firstTextMs: 100, totalMs: 500, rendererMs: 0 })
  assert.equal(result.groups[1]!.baselineEnabled, false)
  assert.equal(result.groups[1]!.rendererMs, 40)
})
