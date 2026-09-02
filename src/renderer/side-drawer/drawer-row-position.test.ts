import assert from 'node:assert/strict'
import test from 'node:test'
import { placeRowMenu, rowMenuAnchor } from './drawer-row-position.js'

test('rowMenuAnchor extracts top-right coordinates', () => {
  const anchor = rowMenuAnchor({ right: 258, top: 120 })
  assert.deepEqual(anchor, { x: 258, y: 120 })
})

test('placeRowMenu places menu downward when space permits', () => {
  const anchor = { x: 258, y: 100 }
  const menu = { width: 200, maxHeight: 300 }
  const viewport = { width: 1200, height: 800 }

  const placement = placeRowMenu(anchor, menu, viewport)
  assert.equal(placement.top, 104)
  assert.equal(placement.left, 262)
  assert.equal(placement.maxHeight, 300)
})

test('placeRowMenu flips upward when bottom is constrained and top has more room', () => {
  const anchor = { x: 258, y: 700 }
  const menu = { width: 200, maxHeight: 300 }
  const viewport = { width: 1200, height: 800 }

  const placement = placeRowMenu(anchor, menu, viewport)
  assert.equal(placement.top, 396)
  assert.equal(placement.maxHeight, 300)
})

test('placeRowMenu flips leftward if overflowing right viewport edge', () => {
  const anchor = { x: 1100, y: 100 }
  const menu = { width: 200, maxHeight: 300 }
  const viewport = { width: 1200, height: 800 }

  const placement = placeRowMenu(anchor, menu, viewport)
  assert.equal(placement.left, 896)
})
