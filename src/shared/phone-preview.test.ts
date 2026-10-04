import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PHONE_BEZEL,
  PHONE_SCREEN,
  PHONE_STATUS_BAR,
  PHONE_VIEWPORT,
  phonePageScale,
  phonePreviewLayout
} from './phone-preview.js'

test('a pane with room shows the phone at actual size, centred', () => {
  const layout = phonePreviewLayout({ width: 1000, height: 1000 })
  assert.equal(layout.scale, 1)
  assert.deepEqual(layout.frame, { x: 290, y: 60, width: 421, height: 880 })
  assert.deepEqual(layout.screen, { x: 290 + PHONE_BEZEL, y: 60 + PHONE_BEZEL, width: PHONE_SCREEN.width, height: PHONE_SCREEN.height })
  assert.deepEqual(layout.page, {
    x: 290 + PHONE_BEZEL,
    y: 60 + PHONE_BEZEL + PHONE_STATUS_BAR,
    width: PHONE_VIEWPORT.width,
    height: PHONE_VIEWPORT.height
  })
  assert.equal(phonePageScale(layout), 1)
})

test('a short pane fits the whole phone and keeps the page inside the screen', () => {
  const pane = { width: 1054, height: 700 }
  const layout = phonePreviewLayout(pane)
  assert.ok(layout.scale < 1)
  assert.ok(layout.frame.y >= 0 && layout.frame.y + layout.frame.height <= pane.height)
  assert.ok(layout.page.y >= layout.screen.y)
  assert.ok(layout.page.y + layout.page.height <= layout.screen.y + layout.screen.height)
  assert.equal(layout.page.width, layout.screen.width)
})

test('the page scale maps the scaled surface back to the full phone viewport width', () => {
  const layout = phonePreviewLayout({ width: 600, height: 640 })
  assert.equal(Math.round(layout.page.width / phonePageScale(layout)), PHONE_VIEWPORT.width)
})

test('a tiny pane bottoms out at the minimum scale instead of collapsing', () => {
  const layout = phonePreviewLayout({ width: 40, height: 40 })
  assert.equal(layout.scale, 0.25)
  assert.ok(layout.page.width > 0 && layout.page.height > 0)
})
