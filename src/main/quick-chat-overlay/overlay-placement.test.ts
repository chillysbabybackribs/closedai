import assert from 'node:assert/strict'
import test from 'node:test'
import { overlaySize, pageSite, quickChatOverlayBounds } from './overlay-placement.js'

const page = { x: 300, y: 80, width: 900, height: 700 }

test('the layer rests in the bottom-right corner of the page', () => {
  assert.deepEqual(quickChatOverlayBounds(page, { width: 64, height: 64 }, true), { x: 1136, y: 716, width: 64, height: 64 })
  assert.deepEqual(quickChatOverlayBounds(page, { width: 640.4, height: 180.6 }, true), { x: 560, y: 599, width: 640, height: 181 })
})

test('the layer never grows past the page', () => {
  assert.deepEqual(quickChatOverlayBounds(page, { width: 1400, height: 900 }, true), { x: 300, y: 80, width: 900, height: 700 })
})

test('a hidden layer parks one pixel inside the window corner at its own size', () => {
  assert.deepEqual(quickChatOverlayBounds(page, { width: 64, height: 64 }, false), { x: -63, y: -63, width: 64, height: 64 })
  assert.deepEqual(quickChatOverlayBounds(page, null, true), { x: 0, y: 0, width: 1, height: 1 })
  assert.deepEqual(quickChatOverlayBounds({ x: 0, y: 0, width: 0, height: 0 }, { width: 64, height: 64 }, true), { x: -63, y: -63, width: 64, height: 64 })
})

test('only a finite positive box is a size', () => {
  assert.deepEqual(overlaySize({ width: 64, height: 40 }), { width: 64, height: 40 })
  assert.equal(overlaySize({ width: 0, height: 40 }), null)
  assert.equal(overlaySize({ width: Number.NaN, height: 40 }), null)
  assert.equal(overlaySize('64x40'), null)
  assert.deepEqual(overlaySize({ width: 1e9, height: 2 }), { width: 10_000, height: 2 })
})

test('a page is named by its host, without www', () => {
  assert.equal(pageSite('https://www.espn.com/mlb/scoreboard'), 'espn.com')
  assert.equal(pageSite('http://localhost:5173/'), 'localhost')
  assert.equal(pageSite('file:///home/dp/notes.html'), null)
  assert.equal(pageSite('about:blank'), null)
  assert.equal(pageSite('not a url'), null)
})
