import assert from 'node:assert/strict'
import test from 'node:test'

import { captureFingerprint, CaptureDedup } from './dedup.js'
import type { CapturedImage } from './host.js'

const sample: CapturedImage = {
  dataUrl: 'data:image/png;base64,AA==',
  width: 100,
  height: 100,
  capturedAt: '2026-09-02T12:00:00.000Z',
  model: { dataUrl: 'data:image/jpeg;base64,BB==', width: 50, height: 50 }
}

test('duplicate detection resets per turn and is scoped per target', () => {
  const dedup = new CaptureDedup()
  const fp = captureFingerprint(sample)
  dedup.resetIfTurn('turn-1')
  dedup.remember('app_window', 'app_window', fp, 'c1')
  assert.deepEqual(dedup.duplicate('app_window', fp), { callId: 'c1', surface: 'app_window' })
  assert.equal(dedup.duplicate('browser_page:tab-1', fp), null)
  dedup.resetIfTurn('turn-2')
  assert.equal(dedup.duplicate('app_window', fp), null)
})
