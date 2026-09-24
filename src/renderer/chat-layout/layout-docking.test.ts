import assert from 'node:assert/strict'
import test from 'node:test'
import { setGroupDocked, expandedPaneIds, ensureExpandedGroup, DOCK_HEIGHT } from './layout-docking.ts'
import { BROWSER_PANE_ID, chatPaneIds, layoutGeometry, readLayout, removePane, saveLayout, type ChatLayout } from './layout-tree.ts'
import { chatTabIds, selectTab } from './layout-tabs.ts'

const pane = (id: string): ChatLayout => ({ kind: 'pane', id })
const split = (id: string, first: ChatLayout, second: ChatLayout, axis: 'horizontal' | 'vertical' = 'horizontal'): ChatLayout =>
  ({ kind: 'split', id, first, second, axis, ratio: 0.5 })
const tree = split('outer', split('left', { kind: 'pane', id: 'a', tabs: ['a', 'extra'] }, pane('b'), 'vertical'),
  split('inner', pane(BROWSER_PANE_ID), split('right', pane('c'), pane('d'), 'vertical')))

test('regional rails stop at the browser and surviving chats fill their region', () => {
  const original = layoutGeometry(tree, 1800, 900)
  const docked = setGroupDocked(setGroupDocked(tree, 'b', true), 'd', true)
  const geometry = layoutGeometry(docked, 1800, 900)
  assert.equal(geometry.rails.length, 2)
  const browser = geometry.panes.find((item) => item.id === BROWSER_PANE_ID)!.rect
  assert.deepEqual(browser, original.panes.find((item) => item.id === BROWSER_PANE_ID)!.rect)
  const [left, right] = geometry.rails
  assert.ok(left!.rect.x + left!.rect.width <= browser.x)
  assert.ok(right!.rect.x >= browser.x + browser.width)
  assert.equal(geometry.panes.find((item) => item.id === 'a')!.rect.height, 900 - DOCK_HEIGHT)
  assert.deepEqual(chatPaneIds(docked), ['a', 'c'])
  assert.deepEqual(chatTabIds(docked), ['a', 'extra', 'b', 'c', 'd'])
  const restored = setGroupDocked(setGroupDocked(docked, 'b', false), 'd', false)
  assert.deepEqual(layoutGeometry(restored, 1800, 900).panes, original.panes)
  assert.equal(layoutGeometry(restored, 1800, 900).rails.length, 0)
})

test('hidden browser joins the regions and a fully docked side remains restorable', () => {
  let docked = setGroupDocked(tree, 'a', true)
  docked = setGroupDocked(docked, 'b', true)
  const geometry = layoutGeometry(docked, 1800, 900)
  assert.equal(geometry.rails.length, 1)
  assert.deepEqual(geometry.rails[0]!.groups.map((group) => group.id), ['a', 'b'])
  assert.equal(layoutGeometry(removePane(docked, BROWSER_PANE_ID)!, 1800, 900).rails.length, 1)
  docked = setGroupDocked(docked, 'c', true)
  assert.equal(setGroupDocked(docked, 'd', true), docked)
  assert.deepEqual(expandedPaneIds(docked), ['d'])
})

test('selecting a docked sibling restores the whole group; archive cannot strand the dock', () => {
  const docked = setGroupDocked(tree, 'a', true)
  const restored = selectTab(docked, 'c', 'extra')
  assert.ok(expandedPaneIds(restored).includes('extra'))
  assert.ok(chatTabIds(restored).includes('a'))
  const pair = setGroupDocked(split('pair', pane('a'), pane('b')), 'a', true)
  assert.deepEqual(expandedPaneIds(ensureExpandedGroup(removePane(pair, 'b')!)), ['a'])
})

test('docking preserves saved group labels, membership and divider ratios', () => {
  const docked = setGroupDocked(tree, 'a', true)
  let saved = ''
  saveLayout({ setItem: (_key, value) => { saved = value } }, '/test', { tree: docked, browserVisible: true })
  assert.deepEqual(readLayout({ getItem: () => saved }, '/test').tree, docked)
  const twice = setGroupDocked(setGroupDocked(docked, 'a', false), 'a', true)
  assert.deepEqual(twice, docked)
})

test('a view-only tile cannot allow the final visible chat to be docked', () => {
  const chatAndView = split('pair', pane('a'), pane('closedai:view:tools:x'))
  assert.equal(setGroupDocked(chatAndView, 'a', true), chatAndView)
})
