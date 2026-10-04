import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PERFORMANCE_SETTINGS, normalizePerformanceSettings } from './performance.js'

test('old profiles keep defaults; persisted settings are bounded and reject invalid numbers', () => {
  assert.deepEqual(normalizePerformanceSettings(null), DEFAULT_PERFORMANCE_SETTINGS)
  assert.deepEqual(normalizePerformanceSettings({ instantStreaming: true, warmMinutes: 100, warmIdleChats: -1, autoTitles: false }), {
    instantStreaming: true, warmMinutes: 60, warmIdleChats: 0, autoTitles: false
  })
  assert.deepEqual(normalizePerformanceSettings({ warmMinutes: NaN, warmIdleChats: '8' }), DEFAULT_PERFORMANCE_SETTINGS)
  assert.equal(normalizePerformanceSettings({ warmMinutes: 7.6 }).warmMinutes, 8)
})
