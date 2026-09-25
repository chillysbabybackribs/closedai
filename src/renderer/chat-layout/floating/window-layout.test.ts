import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, chatPaneIds, layoutGeometry, readLayout, saveLayout, type ChatLayout } from '../layout-tree.ts'
import { tabIds, tabOwner } from '../layout-tabs.ts'
import { clampWindow, findWindow, floatBeside, floatWindow, floatingWindows, groupWindow, minimizeWindow, raiseWindow, resizeRect, restoreWindow, snapWindow, tearOffRect } from './window-layout.ts'

const pane = (id: string, tabs?: string[]): ChatLayout => ({ kind: 'pane', id, ...(tabs ? { tabs } : {}) })
const split = (id: string, first: ChatLayout, second: ChatLayout): ChatLayout => ({ kind: 'split', id, axis: 'horizontal', ratio: 0.5, first, second })
const three = split('outer', split('left', pane('a', ['a', 'a2']), pane('b')), pane(BROWSER_PANE_ID))
const rect = { x: 40, y: 30, width: 500, height: 400 }

test('floating a window lifts it out of the tiled layer, in front, and keeps its tabs', () => {
  const floated = floatWindow(three, 'a', rect)
  assert.deepEqual(layoutGeometry(floated, 1600, 900).panes.map((tile) => tile.id), ['b', BROWSER_PANE_ID])
  assert.deepEqual(findWindow(floated, 'a')?.float, { ...rect, z: 1 })
  assert.deepEqual(tabIds(floated), ['a', 'a2', 'b'])
  assert.deepEqual(chatPaneIds(floated), ['a', 'b'], 'a floating window is still visible to main')
  const both = floatWindow(floated, 'b', rect)
  assert.deepEqual(floatingWindows(both).map((tile) => [tile.id, tile.float.z]), [['a', 1], ['b', 2]])
})

test('raising restacks without growing z, and a window already in front is untouched', () => {
  const stacked = floatWindow(floatWindow(three, 'a', rect), 'b', rect)
  const raised = raiseWindow(stacked, 'a')
  assert.deepEqual(floatingWindows(raised).map((tile) => [tile.id, tile.float.z]), [['b', 1], ['a', 2]])
  assert.equal(raiseWindow(raised, 'a'), raised)
  assert.equal(raiseWindow(raised, BROWSER_PANE_ID), raised, 'a tiled window has no stack place')
})

test('snapping returns a floating window to the tiled layer at a workspace edge or beside a window', () => {
  const floated = floatWindow(three, 'a', rect)
  const left = snapWindow(floated, 'a', WORKSPACE_DOCK_ID, 'left', 'col')
  assert.equal(findWindow(left, 'a')?.float, undefined)
  const panes = layoutGeometry(left, 1600, 900).panes
  const a = panes.find((tile) => tile.id === 'a')!.rect
  assert.equal(a.x, 0)
  assert.equal(a.height, 900, 'a full-height column')
  const beside = snapWindow(floated, 'a', 'b', 'bottom', 'under')
  assert.deepEqual(layoutGeometry(beside, 1600, 900).panes.map((tile) => tile.id), ['b', 'a', BROWSER_PANE_ID])
  const browser = snapWindow(floatWindow(three, BROWSER_PANE_ID, rect), BROWSER_PANE_ID, WORKSPACE_DOCK_ID, 'left', 'col')
  assert.equal(layoutGeometry(browser, 1600, 900).panes.find((tile) => tile.id === BROWSER_PANE_ID)!.rect.x, 0)
})

test('grouping joins every tab to the target and keeps the source front tab in front', () => {
  const floated = floatWindow(three, 'a', rect)
  const grouped = groupWindow(floated, 'a', 'b')
  assert.equal(findWindow(grouped, 'a')?.tabs?.join(','), 'b,a2,a')
  assert.equal(tabOwner(grouped, 'a2'), 'a')
  assert.equal(floatingWindows(grouped).length, 0, 'the emptied floating window is gone')
  assert.equal(groupWindow(three, 'a', BROWSER_PANE_ID), three)
  assert.equal(groupWindow(three, BROWSER_PANE_ID, 'b'), three)
})

test('a window opened beside a floating one cascades from it; beside a tiled one it stays tiled', () => {
  const floated = floatWindow(split('pair', three, pane('new')), 'a', rect)
  const cascaded = floatBeside(floated, 'new', 'a2')
  assert.deepEqual(findWindow(cascaded, 'new')?.float, { x: 72, y: 62, width: 500, height: 400, z: 2 })
  assert.equal(floatBeside(floated, 'new', 'b'), floated)
})

test('minimize keeps the window in place until it is restored, never the last chat or the browser', () => {
  const floated = floatWindow(three, 'a', rect)
  const minimized = minimizeWindow(floated, 'a2')
  assert.equal(floatingWindows(minimized).length, 0)
  assert.deepEqual(chatPaneIds(minimized), ['b'])
  assert.equal(minimizeWindow(minimized, 'b'), minimized, 'the last visible chat stays')
  assert.equal(minimizeWindow(three, BROWSER_PANE_ID), three)
  const restored = restoreWindow(minimized, 'a2')
  assert.deepEqual(findWindow(restored, 'a')?.float, { ...rect, z: 1 })
})

test('floating rects persist and malformed ones are refused', () => {
  const floated = floatWindow(three, 'a', rect)
  let saved = ''
  saveLayout({ setItem: (_key, value) => { saved = value } }, 'space', { tree: floated, browserVisible: true })
  assert.deepEqual(readLayout({ getItem: () => saved }, 'space').tree, floated)
  const bad = saved.replace('"z":1', '"z":-1')
  assert.equal(readLayout({ getItem: () => bad }, 'space').tree, null)
})

test('clamping keeps the header reachable and the window at least its floor', () => {
  const canvas = { width: 1200, height: 800 }
  const minimum = { width: 300, height: 280 }
  assert.deepEqual(clampWindow({ x: 1180, y: 900, width: 100, height: 100 }, canvas, minimum), { x: 1104, y: 762, width: 300, height: 280 })
  assert.deepEqual(clampWindow({ x: -900, y: -40, width: 2000, height: 400 }, canvas, minimum), { x: -900, y: 0, width: 1200, height: 400 })
  assert.deepEqual(clampWindow(rect, { width: 0, height: 0 }, minimum), rect)
})

test('tearing off keeps the grabbed point under the pointer', () => {
  const torn = tearOffRect({ x: 0, y: 0, width: 1000, height: 900 }, { width: 1600, height: 900 }, { x: 500, y: 12 }, { width: 300, height: 280 })
  assert.deepEqual(torn, { x: 140, y: 0, width: 720, height: 675 })
})

test('resizing moves only the grabbed edges and stops at the floor', () => {
  const minimum = { width: 300, height: 280 }
  assert.deepEqual(resizeRect(rect, 'se', 50, 20, minimum), { x: 40, y: 30, width: 550, height: 420 })
  assert.deepEqual(resizeRect(rect, 'nw', 50, 20, minimum), { x: 90, y: 50, width: 450, height: 380 })
  assert.deepEqual(resizeRect(rect, 'w', 400, 0, minimum), { x: 240, y: 30, width: 300, height: 400 })
})
