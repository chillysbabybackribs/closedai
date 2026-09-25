import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, layoutGeometry, removePane, type ChatLayout } from '../layout-tree.ts'
import { floatWindow, minimizeWindow } from './window-layout.ts'
import { ON_TOP, browserCovered, canvasTiles, floatingFront, uncoveredRect } from './window-tiles.ts'
import { setWindowOnTop } from './window-arrange.ts'

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

test('a window kept on top stacks above every other and the browser gives way to it', () => {
  const kept = setWindowOnTop(floatWindow(tree, 'a', { x: 900, y: 0, width: 300, height: 300 }), 'a', true)
  const shown = tiles(kept)
  assert.ok(shown.find((tile) => tile.id === 'a')!.z > ON_TOP)
  assert.deepEqual(shown.find((tile) => tile.id === BROWSER_PANE_ID)!.rect, { x: 607, y: 300, width: 593, height: 500 }, 'the part below it')
  assert.equal(browserCovered(shown), false, 'the page stays live')
  const raised = floatWindow(kept, 'b', { x: 850, y: 50, width: 300, height: 300 })
  assert.deepEqual(floatingFront(tiles(raised)).map((tile) => tile.id), ['a', 'b'], 'still above a window moved later')
  assert.equal(tiles(setWindowOnTop(tree, 'b', true)).find((tile) => tile.id === 'b')!.z, ON_TOP, 'a tiled window too')
})

test('with no part big enough the browser keeps its rect and shows its still', () => {
  const kept = setWindowOnTop(floatWindow(tree, 'a', { x: 700, y: 200, width: 400, height: 400 }), 'a', true)
  const shown = tiles(kept)
  assert.deepEqual(shown.find((tile) => tile.id === BROWSER_PANE_ID)!.rect, { x: 607, y: 0, width: 593, height: 800 })
  assert.equal(browserCovered(shown), true)
  assert.equal(uncoveredRect({ x: 0, y: 0, width: 100, height: 100 }, { x: 200, y: 0, width: 10, height: 10 }, { width: 50, height: 50 })?.width, 100)
})
