import assert from 'node:assert/strict'
import test from 'node:test'

import type { TraceEntry } from '../../shared/trace.js'
import { summarizeTracePerformance } from './trace-performance.js'

let seq = 0
function entry(kind: TraceEntry['kind'], label: string, extra: Partial<TraceEntry> = {}): TraceEntry {
  return {
    seq: ++seq, at: 1_000 + seq, paneId: 'p', provider: 'codex', turnId: 't',
    kind, label, summary: label, detail: '', truncated: false, ...extra
  }
}

test('summarizes Codex model passes, cache efficiency, context, and tool time', () => {
  const usage = {
    method: 'thread/tokenUsage/updated',
    params: { tokenUsage: {
      total: {
        inputTokens: 970_487, cachedInputTokens: 961_152,
        outputTokens: 1_979, reasoningOutputTokens: 693
      },
      last: { totalTokens: 62_904, reasoningOutputTokens: 34 },
      modelContextWindow: 258_400
    } }
  }
  const value = summarizeTracePerformance([
    entry('event', 'item.user'),
    entry('tool', 'tool.call'),
    entry('tool', 'tool.result', { durationMs: 220, ok: false }),
    entry('raw', 'codex.in', { summary: 'thread/tokenUsage/updated', detail: JSON.stringify(usage) }),
    entry('raw', 'codex.in', { summary: 'thread/tokenUsage/updated', detail: JSON.stringify(usage) })
  ], 72_000)

  assert.equal(value.modelPasses, 2)
  assert.deepEqual(value.tokens, {
    input: 970_487, cachedInput: 961_152, uncachedInput: 9_335,
    output: 1_979, reasoning: 693
  })
  assert.deepEqual(value.lastContext, { used: 62_870, window: 258_400, percent: 24 })
  assert.equal(value.toolCalls, 1)
  assert.equal(value.toolFailures, 1)
  assert.equal(value.toolDurationMs, 220)
  assert.equal(value.nonToolDurationMs, 71_780)
  assert.equal(value.transcriptEvents, 1)
  assert.equal(value.rawEvents, 2)
})

test('ignores malformed raw detail and does not invent provider metrics', () => {
  const value = summarizeTracePerformance([
    entry('raw', 'codex.in', { summary: 'thread/tokenUsage/updated', detail: '{bad' })
  ], null)
  assert.equal(value.modelPasses, 0)
  assert.equal(value.tokens, null)
  assert.equal(value.lastContext, null)
  assert.equal(value.nonToolDurationMs, null)
})
