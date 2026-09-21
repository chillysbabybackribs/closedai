import assert from 'node:assert/strict'
import test from 'node:test'
import { menuIndexForKey, opensContextMenu, tabIndexForKey, tabPanelId } from './browser-tab-navigation.ts'

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

test('menu items rove vertically with wrapping, Home and End', () => {
  assert.equal(menuIndexForKey('ArrowDown', 0, 3), 1)
  assert.equal(menuIndexForKey('ArrowDown', 2, 3), 0)
  assert.equal(menuIndexForKey('ArrowUp', 0, 3), 2)
  assert.equal(menuIndexForKey('Home', 2, 3), 0)
  assert.equal(menuIndexForKey('End', 0, 3), 2)
  assert.equal(menuIndexForKey('ArrowRight', 0, 3), null)
  assert.equal(menuIndexForKey('ArrowDown', 0, 0), null)
})

test('the context-menu key and Shift+F10 open the tab menu; F10 alone does not', () => {
  assert.equal(opensContextMenu({ key: 'ContextMenu', shiftKey: false }), true)
  assert.equal(opensContextMenu({ key: 'F10', shiftKey: true }), true)
  assert.equal(opensContextMenu({ key: 'F10', shiftKey: false }), false)
  assert.equal(opensContextMenu({ key: 'Enter', shiftKey: true }), false)
})

test('a tab controls its own viewer panel or the shared page host', () => {
  assert.equal(tabPanelId({ id: 't1' }), 'browser-page')
  assert.equal(tabPanelId({ id: 't2', image: { url: 'x' } as never }), 'image-page-t2')
  assert.equal(tabPanelId({ id: 't3', file: { path: 'x' } as never }), 'file-page-t3')
})
