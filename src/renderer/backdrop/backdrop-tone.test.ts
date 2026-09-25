import assert from 'node:assert/strict'
import test from 'node:test'
import { accentColor, backdropTone, meanLuminance } from './backdrop-tone.js'

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
  assert.ok(bright.rail > dark.rail)
  assert.ok(bright.rail < bright.glass, 'the rails stay lighter glass than a tile')
})

test('the tone stays inside its legibility bounds for any input', () => {
  assert.deepEqual(backdropTone(-1), { dim: 0.18, glass: 0.84, rail: 0.5 })
  assert.deepEqual(backdropTone(5), { dim: 0.62, glass: 0.94, rail: 0.7 })
})

test('the accent is the most vivid hue, not the most common one', () => {
  // Mostly a dull blue-grey sky with a small saturated orange sunset band.
  const sky = [96, 104, 120, 255]
  const sunset = [236, 120, 40, 255]
  const pixels = [...Array(20).fill(sky).flat(), ...Array(3).fill(sunset).flat()]
  const accent = accentColor(pixels)
  assert.ok(accent)
  const hue = Number(/^hsl\((\d+) /.exec(accent)![1])
  assert.ok(hue >= 15 && hue <= 35, `expected an orange hue, got ${accent}`)
  assert.match(accent, / 64%\)$/)
})

test('a colourless wallpaper yields no accent', () => {
  assert.equal(accentColor([40, 40, 40, 255, 200, 200, 200, 255]), null)
  assert.equal(accentColor([]), null)
})
