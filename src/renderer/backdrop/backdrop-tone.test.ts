import assert from 'node:assert/strict'
import test from 'node:test'
import { accentColor, backdropTone, meanLuminance, railTint } from './backdrop-tone.js'

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

test('each rail is tinted to the band behind it so a bright sky and dark ground match', () => {
  // Fuji: a bright sunset sky behind the title bar, a dark foreground behind the dock.
  const top = railTint(0.348)
  const bottom = railTint(0.082)
  assert.ok(top > bottom)
  assert.ok(Math.abs((1 - top) * 0.348 - (1 - bottom) * 0.082) < 0.005, 'both rails land at the same darkness')
  assert.equal(railTint(0), 0.7)
  assert.equal(railTint(1), 0.96)
})

test('the tone stays inside its legibility bounds for any input', () => {
  assert.deepEqual(backdropTone(-1), { dim: 0.18, glass: 0.84 })
  assert.deepEqual(backdropTone(5), { dim: 0.62, glass: 0.94 })
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
