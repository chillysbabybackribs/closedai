import assert from 'node:assert/strict'
import test from 'node:test'
import { tabIndexForKey } from './browser-tab-navigation.ts'

test('moves across browser tabs with wrapping arrow keys', () => {
  assert.equal(tabIndexForKey('ArrowRight', 0, 3), 1)
  assert.equal(tabIndexForKey('ArrowRight', 2, 3), 0)
  assert.equal(tabIndexForKey('ArrowLeft', 0, 3), 2)
  assert.equal(tabIndexForKey('ArrowLeft', 1, 3), 0)
})

test('moves to the first or last browser tab with Home and End', () => {
  assert.equal(tabIndexForKey('Home', 2, 3), 0)
  assert.equal(tabIndexForKey('End', 0, 3), 2)
})

test('ignores unrelated keys and an empty tab strip', () => {
  assert.equal(tabIndexForKey('Enter', 0, 2), null)
  assert.equal(tabIndexForKey('ArrowRight', 0, 0), null)
})
