import assert from 'node:assert/strict'
import test from 'node:test'
import { setGroupDocked, expandedPaneIds, ensureExpandedGroup, tiledTree } from './layout-docking.ts'
import { BROWSER_PANE_ID, chatPaneIds, layoutGeometry, readLayout, removePane, saveLayout, type ChatLayout } from './layout-tree.ts'
import { chatTabIds, selectTab } from './layout-tabs.ts'

const pane = (id: string): ChatLayout => ({ kind: 'pane', id })
const split = (id: string, first: ChatLayout, second: ChatLayout, axis: 'horizontal' | 'vertical' = 'horizontal'): ChatLayout =>
  ({ kind: 'split', id, first, second, axis, ratio: 0.5 })
const tree = split('outer', split('left', { kind: 'pane', id: 'a', tabs: ['a', 'extra'] }, pane('b'), 'vertical'),
  split('inner', pane(BROWSER_PANE_ID), split('right', pane('c'), pane('d'), 'vertical')))

test('minimized windows leave the tiled layer and come back to their slot', () => {
  const original = layoutGeometry(tree, 1800, 900)
  const docked = setGroupDocked(setGroupDocked(tree, 'b', true), 'd', true)
  const geometry = layoutGeometry(docked, 1800, 900)
  assert.deepEqual(geometry.panes.map((item) => item.id).sort(), ['a', 'c', BROWSER_PANE_ID].sort())
  assert.equal(geometry.panes.find((item) => item.id === 'a')!.rect.height, 900, 'the survivor fills its column')
  assert.deepEqual(chatPaneIds(docked), ['a', 'c'])
  assert.deepEqual(chatTabIds(docked), ['a', 'extra', 'b', 'c', 'd'])
  const restored = setGroupDocked(setGroupDocked(docked, 'b', false), 'd', false)
  assert.deepEqual(layoutGeometry(restored, 1800, 900).panes, original.panes)
})

test('floating windows take no tiled space', () => {
  const floated: ChatLayout = split('pair', pane('a'), { kind: 'pane', id: 'b', float: { x: 10, y: 10, width: 400, height: 300, z: 1 } })
  assert.deepEqual(tiledTree(floated), pane('a'))
  assert.deepEqual(layoutGeometry(floated, 1200, 800).panes.map((item) => item.id), ['a'])
  assert.deepEqual(chatPaneIds(floated), ['a', 'b'])
  const alone: ChatLayout = { kind: 'pane', id: 'a', float: { x: 0, y: 0, width: 400, height: 300, z: 1 } }
  assert.deepEqual(layoutGeometry(alone, 1200, 800), { panes: [], dividers: [], minimum: { width: 0, height: 0 } })
})

test('a fully minimized side remains restorable', () => {
  let docked = setGroupDocked(tree, 'a', true)
  docked = setGroupDocked(docked, 'b', true)
  assert.deepEqual(layoutGeometry(removePane(docked, BROWSER_PANE_ID)!, 1800, 900).panes.map((item) => item.id), ['c', 'd'])
  docked = setGroupDocked(docked, 'c', true)
  assert.deepEqual(expandedPaneIds(docked), ['d'])
  assert.deepEqual(expandedPaneIds(setGroupDocked(docked, 'd', true)), [])
})

test('selecting a minimized sibling restores the whole window; archive cannot strand the dock', () => {
  const docked = setGroupDocked(tree, 'a', true)
  const restored = selectTab(docked, 'c', 'extra')
  assert.ok(expandedPaneIds(restored).includes('extra'))
  assert.ok(chatTabIds(restored).includes('a'))
  const pair = setGroupDocked(split('pair', pane('a'), pane('b')), 'a', true)
  assert.deepEqual(expandedPaneIds(ensureExpandedGroup(removePane(pair, 'b')!)), ['a'])
})

test('minimizing preserves saved group labels, membership and divider ratios', () => {
  const docked = setGroupDocked(tree, 'a', true)
  let saved = ''
  saveLayout({ setItem: (_key, value) => { saved = value } }, '/test', { tree: docked, browserVisible: true })
  assert.deepEqual(readLayout({ getItem: () => saved }, '/test').tree, docked)
  const twice = setGroupDocked(setGroupDocked(docked, 'a', false), 'a', true)
  assert.deepEqual(twice, docked)
})

test('the final visible chat can be docked, leaving only the dock', () => {
  const chatAndView = split('pair', pane('a'), pane('closedai:view:tools:x'))
  assert.equal(setGroupDocked(chatAndView, 'a', true) === chatAndView, false)
})
