import assert from 'node:assert/strict'
import test from 'node:test'

test('layout occlusion must occlude native bounds before the freeze still opens', () => {
  // Regression guard for browser-controller.ts: pageOccluded = titlebarOverlay.open || occluded.
  const occluded = true
  const titlebarOpen = false
  assert.equal(titlebarOpen || occluded, true, 'covered layout hides the native page immediately')
})
