import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ANTIGRAVITY_IMPLICIT_CACHE_MIN_TOKENS,
  classifyAntigravityCache
} from './antigravity-cache-diagnostics.ts'

test('the eligibility threshold matches the documented implicit-cache minimum', () => {
  assert.equal(ANTIGRAVITY_IMPLICIT_CACHE_MIN_TOKENS, 4096)
})

test('a large prompt reporting zero cache reads is the anomaly', () => {
  const report = classifyAntigravityCache({ inputTokens: 15_337, cacheReadTokens: 0 })
  assert.equal(report.eligible, true)
  assert.equal(report.anomaly, true)
  assert.equal(report.hitPercent, 0)
})

test('the documented healthy reading is not an anomaly', () => {
  const report = classifyAntigravityCache({ inputTokens: 10_415, cacheReadTokens: 8_113 })
  assert.equal(report.eligible, true)
  assert.equal(report.anomaly, false)
  assert.equal(report.hitPercent, 77.9)
})

test('a prompt below the threshold is never flagged', () => {
  const report = classifyAntigravityCache({ inputTokens: 4_095, cacheReadTokens: 0 })
  assert.equal(report.eligible, false)
  assert.equal(report.anomaly, false)
  assert.equal(classifyAntigravityCache({ inputTokens: 4_096, cacheReadTokens: 0 }).anomaly, true)
})

test('silence is not an anomaly — only a measured zero is', () => {
  const silent = classifyAntigravityCache({ inputTokens: 50_000, cacheReadTokens: undefined })
  assert.equal(silent.eligible, true)
  assert.equal(silent.anomaly, false)
  assert.equal(silent.hitPercent, null)
})
