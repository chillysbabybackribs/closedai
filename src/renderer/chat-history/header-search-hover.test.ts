import assert from 'node:assert/strict'
import test from 'node:test'

import { pointerKeepsSearchOpen } from './header-search-hover.ts'

const field = { left: 230, top: 7, right: 515, bottom: 37 }
const popup = { left: 67, top: 43, right: 678, bottom: 198 }

test('the field, the popup, and the band between them all keep the search open', () => {
  assert.equal(pointerKeepsSearchOpen({ x: 300, y: 20 }, field, popup), true)
  assert.equal(pointerKeepsSearchOpen({ x: 80, y: 150 }, field, popup), true)
  assert.equal(pointerKeepsSearchOpen({ x: 670, y: 150 }, field, popup), true)
  // The gap beside the field but under the popup's width: no DOM node of the component is there.
  assert.equal(pointerKeepsSearchOpen({ x: 80, y: 40 }, field, popup), true)
  assert.equal(pointerKeepsSearchOpen({ x: 660, y: 39 }, field, popup), true)
})

test('outside the union closes, including beside the field on the title bar', () => {
  assert.equal(pointerKeepsSearchOpen({ x: 80, y: 20 }, field, popup), false)
  assert.equal(pointerKeepsSearchOpen({ x: 600, y: 20 }, field, popup), false)
  assert.equal(pointerKeepsSearchOpen({ x: 300, y: 220 }, field, popup), false)
  assert.equal(pointerKeepsSearchOpen({ x: 50, y: 100 }, field, popup), false)
})

test('without a popup only the field counts', () => {
  assert.equal(pointerKeepsSearchOpen({ x: 300, y: 20 }, field, null), true)
  assert.equal(pointerKeepsSearchOpen({ x: 300, y: 60 }, field, null), false)
})
