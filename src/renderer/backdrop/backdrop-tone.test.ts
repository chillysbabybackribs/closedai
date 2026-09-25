import assert from 'node:assert/strict'
import test from 'node:test'
import { backdropTone, meanLuminance } from './backdrop-tone.js'

test('mean luminance spans black to white in linear light', () => {
  assert.equal(meanLuminance([0, 0, 0, 255, 0, 0, 0, 255]), 0)
  assert.equal(meanLuminance([255, 255, 255, 255]), 1)
  // sRGB mid-grey is about a fifth of white's light, not half.
  assert.ok(Math.abs(meanLuminance([128, 128, 128, 255]) - 0.216) < 0.01)
  assert.equal(meanLuminance([]), 0)
})

test('brighter wallpapers get a heavier dim and a denser glass tint', () => {
  const dark = backdropTone(0.02)
  const bright = backdropTone(0.6)
  assert.ok(bright.dim > dark.dim)
  assert.ok(bright.glass > dark.glass)
})

test('the tone stays inside its legibility bounds for any input', () => {
  assert.deepEqual(backdropTone(-1), { dim: 0.18, glass: 0.84 })
  assert.deepEqual(backdropTone(5), { dim: 0.62, glass: 0.94 })
})
