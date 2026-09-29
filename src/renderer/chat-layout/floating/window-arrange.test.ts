import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, layoutGeometry, type ChatLayout } from '../layout-tree.ts'
import { findWindow, floatWindow, floatingWindows } from './window-layout.ts'
import { halfRect, hasFloatingWindows, setWindowOnTop, snapToSide, tabTearOffRect, tearOffTab, tearOffWindow, tileWindow, tileWindows } from './window-arrange.ts'
import { tabIds, tabOwner } from '../layout-tabs.ts'

const size = { width: 1200, height: 800 }
const tree: ChatLayout = { kind: 'split', id: 'root', axis: 'horizontal', ratio: 0.6,
  first: { kind: 'split', id: 'chats', axis: 'vertical', ratio: 0.5, first: { kind: 'pane', id: 'a', tabs: ['a', 'a2'] }, second: { kind: 'pane', id: 'b' } },
  second: { kind: 'pane', id: BROWSER_PANE_ID } }
const onScreen = (layout: ChatLayout) => layoutGeometry(layout, size.width, size.height).panes.map(({ id, rect }) => ({ id, rect }))
const floats = (layout: ChatLayout) => floatingWindows(layout).map(({ id, float: { x, y, width, height } }) => ({ id, rect: { x, y, width, height } }))
const torn = { x: 500, y: 100, width: 500, height: 500 }

test('tearing a window out leaves the others floating exactly where they were, behind it', () => {
  const before = onScreen(tree)
  const after = tearOffWindow(tree, BROWSER_PANE_ID, torn, before)
  assert.deepEqual(onScreen(after), [], 'nothing is left to grow into the space')
  assert.deepEqual(floats(after), [...before.filter((tile) => tile.id !== BROWSER_PANE_ID), { id: BROWSER_PANE_ID, rect: torn }])
  assert.ok(hasFloatingWindows(after))
  assert.ok(!hasFloatingWindows(tree))
})

test('Tile windows puts the last tiled layout back exactly; one window can go back alone', () => {
  const after = tearOffWindow(tree, BROWSER_PANE_ID, torn, onScreen(tree))
  assert.deepEqual(tileWindows(after), tree)
  assert.equal(tileWindows(tree), tree, 'nothing floating is the same tree')
  const one = tileWindow(after, 'a2')
  assert.equal(findWindow(one, 'a')?.float, undefined, 'a tab names its window')
  assert.deepEqual(floats(one).map((tile) => tile.id), ['b', BROWSER_PANE_ID])
})

test('a side takes half the workspace while nothing is tiled, and pairs with a window filling the other half', () => {
  const loose = tearOffWindow(tree, BROWSER_PANE_ID, torn, onScreen(tree))
  const left = snapToSide(loose, 'a', 'left', size, [], floats(loose), 'pair')
  assert.deepEqual(findWindow(left, 'a')?.float && floats(left).find((tile) => tile.id === 'a')?.rect, halfRect('left', size))
  const paired = snapToSide(left, BROWSER_PANE_ID, 'right', size, [], [...floats(left)].reverse(), 'pair')
  assert.deepEqual(onScreen(paired), [{ id: 'a', rect: { x: 0, y: 0, width: 593, height: 800 } }, { id: BROWSER_PANE_ID, rect: { x: 607, y: 0, width: 593, height: 800 } }])
  assert.deepEqual(floats(paired).map((tile) => tile.id), ['b'], 'the other windows stay put')
})

test('the pair keeps the width of the window already on the other side', () => {
  const narrow = floatWindow(tree, 'a', { x: 0, y: 0, width: 400, height: 800 })
  const loose = tearOffWindow(narrow, BROWSER_PANE_ID, torn, onScreen(narrow))
  const paired = snapToSide(loose, BROWSER_PANE_ID, 'right', size, [], floats(loose).reverse(), 'pair')
  assert.equal(onScreen(paired).find((tile) => tile.id === 'a')?.rect.width, 400)
})

test('beside tiled windows a side is still a full-height column', () => {
  const floated = floatWindow(tree, 'b', torn)
  const column = snapToSide(floated, 'b', 'left', size, onScreen(floated), floats(floated), 'col')
  const { id, rect } = onScreen(column)[0]!
  assert.deepEqual([id, rect.x, rect.height], ['b', 0, 800])
  assert.equal(onScreen(column).length, 3)
})

test('Keep on top belongs to the whole window, never the browser', () => {
  const kept = setWindowOnTop(tree, 'a2', true)
  assert.equal(findWindow(kept, 'a')?.onTop, true)
  assert.equal(setWindowOnTop(kept, 'a', true), kept)
  assert.deepEqual(setWindowOnTop(kept, 'a', false), tree)
  assert.equal(setWindowOnTop(tree, BROWSER_PANE_ID, true), tree)
})

test('a kept window survives a save and load; a kept browser does not', async () => {
  const { readLayout, saveLayout } = await import('../layout-tree.ts')
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
  saveLayout(storage, 'p', { tree: setWindowOnTop(tree, 'a', true), browserVisible: true })
  assert.equal(findWindow(readLayout(storage, 'p').tree!, 'a')?.onTop, true)
  const browserKept = { ...tree, second: { kind: 'pane' as const, id: BROWSER_PANE_ID, onTop: true } }
  saveLayout(storage, 'p', { tree: browserKept, browserVisible: true })
  assert.equal(readLayout(storage, 'p').tree, null)
})

test('a side target resolves the same way for the preview', async () => {
  const { targetPreview } = await import('./window-targets.ts')
  const loose = tearOffWindow(tree, BROWSER_PANE_ID, torn, onScreen(tree))
  assert.deepEqual(targetPreview(loose, 'b', { kind: 'split', target: WORKSPACE_DOCK_ID, edge: 'right' }, size, true, [], floats(loose)), halfRect('right', size))
})

test('a tab torn off opens its own floating window and leaves the tiled layout and its siblings alone', () => {
  const before = onScreen(tree)
  for (const id of ['a', 'a2']) {
    const after = tearOffTab(tree, id, torn, before, 'tear')
    assert.deepEqual(onScreen(after), before.map((tile) => tile.id === 'a' ? { ...tile, id: id === 'a' ? 'a2' : 'a' } : tile))
    assert.deepEqual(floats(after), [{ id, rect: torn }])
    assert.equal(tabOwner(after, id), id)
    assert.deepEqual(tabIds(after).sort(), tabIds(tree).sort(), 'no tab is lost or duplicated')
    assert.equal(tileWindows(after).kind, 'split', 'Tile windows gives it a slot beside the window it left')
  }
})

test("a window's only tab moves the whole window; the browser never tears", () => {
  const before = onScreen(tree)
  const moved = tearOffTab(tree, 'b', torn, before, 'tear')
  assert.deepEqual(moved, tearOffWindow(tree, 'b', torn, before))
  const again = tearOffTab(moved, 'b', { ...torn, x: 20 }, [], 'tear')
  assert.deepEqual(floats(again).find((tile) => tile.id === 'b')?.rect, { ...torn, x: 20 })
  assert.equal(tearOffTab(tree, BROWSER_PANE_ID, torn, before, 'tear'), tree)
  assert.equal(tearOffTab(tree, 'missing', torn, before, 'tear'), tree)
})

test('a torn-off tab keeps a floating window\'s size, takes a share of a tiled one, and sits under the pointer', () => {
  const source = { x: 0, y: 0, width: 1000, height: 800 }
  assert.deepEqual(tabTearOffRect(source, true, size, { x: 600, y: 300 }, 'a'), { x: 504, y: 281, width: 1000, height: 800 })
  assert.deepEqual(tabTearOffRect(source, false, size, { x: 600, y: 300 }, 'a'), { x: 504, y: 281, width: 540, height: 600 })
  assert.deepEqual(tabTearOffRect({ ...source, width: 100, height: 100 }, true, size, { x: 100, y: 100 }, 'a'),
    { x: 25, y: 81, width: 300, height: 280 }, 'never below the window floor')
})
