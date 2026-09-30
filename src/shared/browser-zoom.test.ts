import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BROWSER_ZOOM_DEFAULT,
  BROWSER_ZOOM_MAX,
  BROWSER_ZOOM_MESSAGE_PREFIX,
  BROWSER_ZOOM_MIN,
  browserZoomFactor,
  clampBrowserZoom,
  parseZoomMessage
} from './browser-zoom.js'

test('clampBrowserZoom rounds to the nearest step and clamps to supported bounds', () => {
  assert.equal(clampBrowserZoom(104), 100)
  assert.equal(clampBrowserZoom(105), 110)
  assert.equal(clampBrowserZoom(114), 110)
  assert.equal(clampBrowserZoom(44), BROWSER_ZOOM_MIN)
  assert.equal(clampBrowserZoom(259), BROWSER_ZOOM_MAX)
  assert.equal(clampBrowserZoom(BROWSER_ZOOM_MIN), BROWSER_ZOOM_MIN)
  assert.equal(clampBrowserZoom(BROWSER_ZOOM_MAX), BROWSER_ZOOM_MAX)
})

test('clampBrowserZoom maps non-finite inputs to the default zoom', () => {
  assert.equal(clampBrowserZoom(Number.NaN), BROWSER_ZOOM_DEFAULT)
  assert.equal(clampBrowserZoom(Number.POSITIVE_INFINITY), BROWSER_ZOOM_DEFAULT)
  assert.equal(clampBrowserZoom(Number.NEGATIVE_INFINITY), BROWSER_ZOOM_DEFAULT)
})

test('browserZoomFactor converts the normalized percent to Chromium multiplier', () => {
  assert.equal(browserZoomFactor(100), 1)
  assert.equal(browserZoomFactor(125), 1.3)
  assert.equal(browserZoomFactor(48), 0.5)
  assert.equal(browserZoomFactor(253), 2.5)
  assert.equal(browserZoomFactor(Number.NaN), 1)
})

test('parseZoomMessage accepts only the exact supported direction payloads', () => {
  assert.equal(parseZoomMessage(`${BROWSER_ZOOM_MESSAGE_PREFIX}1`), 1)
  assert.equal(parseZoomMessage(`${BROWSER_ZOOM_MESSAGE_PREFIX}-1`), -1)

  for (const message of [
    'ordinary page log',
    `${BROWSER_ZOOM_MESSAGE_PREFIX}`,
    `${BROWSER_ZOOM_MESSAGE_PREFIX}0`,
    `${BROWSER_ZOOM_MESSAGE_PREFIX}2`,
    `${BROWSER_ZOOM_MESSAGE_PREFIX}+1`,
    `${BROWSER_ZOOM_MESSAGE_PREFIX}01`,
    `${BROWSER_ZOOM_MESSAGE_PREFIX}1 `,
    ` ${BROWSER_ZOOM_MESSAGE_PREFIX}1`,
    `${BROWSER_ZOOM_MESSAGE_PREFIX}-1\n`,
    `${BROWSER_ZOOM_MESSAGE_PREFIX}1:extra`
  ]) {
    assert.equal(parseZoomMessage(message), 0, JSON.stringify(message))
  }
})
