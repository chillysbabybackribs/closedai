import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, layoutGeometry, removePane, type ChatLayout } from '../layout-tree.ts'
import { floatWindow, minimizeWindow } from './window-layout.ts'
import { browserCovered, canvasTiles, floatingFront } from './window-tiles.ts'

const size = { width: 1200, height: 800 }
const tree: ChatLayout = { kind: 'split', id: 'root', axis: 'horizontal', ratio: 0.5,
  first: { kind: 'split', id: 'chats', axis: 'vertical', ratio: 0.5, first: { kind: 'pane', id: 'a' }, second: { kind: 'pane', id: 'b' } },
  second: { kind: 'pane', id: BROWSER_PANE_ID } }
const tiles = (layout: ChatLayout, browserVisible = true) =>
  canvasTiles(layout, layoutGeometry(browserVisible ? layout : removePane(layout, BROWSER_PANE_ID)!, size.width, size.height).panes, size, browserVisible)

test('windows keep tree order whatever layer they are in', () => {
  const floated = floatWindow(tree, 'a', { x: 700, y: 100, width: 400, height: 300 })
  assert.deepEqual(tiles(floated).map((tile) => [tile.id, tile.kind]), [['a', 'floating'], ['b', 'tiled'], [BROWSER_PANE_ID, 'tiled']])
  assert.deepEqual(tiles(floated, false).map((tile) => tile.kind), ['floating', 'tiled', 'hidden'])
  const minimized = minimizeWindow(floated, 'a')
  assert.deepEqual(tiles(minimized).map((tile) => tile.kind), ['hidden', 'tiled', 'tiled'])
})

test('a floating window over the browser covers it until the browser is in front', () => {
  const over = floatWindow(tree, 'a', { x: 700, y: 100, width: 400, height: 300 })
  assert.equal(browserCovered(tiles(over)), true)
  assert.equal(browserCovered(tiles(floatWindow(tree, 'a', { x: 10, y: 10, width: 300, height: 300 }))), false)
  const browserFront = floatWindow(over, BROWSER_PANE_ID, { x: 600, y: 50, width: 500, height: 500 })
  assert.equal(browserCovered(tiles(browserFront)), false)
  assert.deepEqual(floatingFront(tiles(browserFront)).map((tile) => tile.id), [BROWSER_PANE_ID, 'a'])
  assert.equal(browserCovered(tiles(over, false)), false)
})
