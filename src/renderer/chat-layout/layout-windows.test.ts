import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, type ChatLayout } from './layout-tree.js'
import { tabIds } from './layout-tabs.js'
import { adoptTabs, dismissWindow, initialWindowTree, type WindowTreeSeed } from './layout-windows.js'

const seed = (patch: Partial<WindowTreeSeed>): WindowTreeSeed => ({
  available: new Set(['a', 'b', 'c']), elsewhere: new Set(), selectedPaneId: 'a', detached: false,
  initialTabs: [], fallbackView: () => 'closedai:view:history:x', ...patch
})
const pane = (id: string, tabs?: string[]): ChatLayout => ({ kind: 'pane', id, ...(tabs ? { tabs } : {}) })

test('the main window drops chats another window holds and never pulls one forward', () => {
  const tree = initialWindowTree(pane('a', ['a', 'b']), seed({ elsewhere: new Set(['b']), selectedPaneId: 'b' }))
  assert.deepEqual(tabIds(tree), ['a'])
})

test('a saved desk does not reopen the backend-selected chat absent from its layout', () => {
  assert.deepEqual(tabIds(initialWindowTree(pane('a'), seed({ selectedPaneId: 'c' }))), ['a'])
  assert.deepEqual(tabIds(initialWindowTree(null, seed({ selectedPaneId: 'c' }))), ['c'])
})

test('a new detached window opens with the tabs moved into it, ignoring the selection', () => {
  const tree = initialWindowTree(null, seed({ detached: true, initialTabs: ['b', 'closedai:view:trace:1'], selectedPaneId: 'a' }))
  assert.deepEqual(tree, { kind: 'pane', id: 'b', tabs: ['b', 'closedai:view:trace:1'] })
})

test('a detached window whose chats are gone shows the history view', () => {
  const tree = initialWindowTree(null, seed({ detached: true, initialTabs: ['gone'] }))
  assert.deepEqual(tree, { kind: 'pane', id: 'closedai:view:history:x' })
})

test('a saved main window whose only chat moved away stays empty', () => {
  const tree = initialWindowTree(pane('b'), seed({ elsewhere: new Set(['b']), selectedPaneId: 'b' }))
  assert.deepEqual(tree, pane(BROWSER_PANE_ID))
})

test('handed-back tabs join the anchor tile once, and a second Agents view is skipped', () => {
  const tree: ChatLayout = { kind: 'split', id: 's', axis: 'horizontal', ratio: 0.5,
    first: pane('a'), second: pane('closedai:view:agents:1') }
  const next = adoptTabs(tree, ['b', 'a', 'closedai:view:agents:2'], 'a')
  assert.deepEqual(tabIds(next), ['a', 'b', 'closedai:view:agents:1'])
})


test('dismissing a card preserves surviving floating, tiled, minimized and maximized windows', () => {
  const float = { x: 80, y: 40, width: 600, height: 700, z: 2 }
  for (const survivor of [pane('b'), { ...pane('b'), float }, { ...pane('b'), float, docked: true }]) {
    const tree: ChatLayout = { kind: 'split', id: 'pair', axis: 'horizontal', ratio: 0.7,
      first: pane('a'), second: survivor }
    const layout = { tree, maximized: 'b', browserVisible: false }
    const next = dismissWindow(layout, 'a')
    assert.equal(next.tree, survivor)
    assert.equal(next.maximized, 'b')
    assert.equal(next.browserVisible, false)
    assert.equal(dismissWindow(next, 'a'), next, 'repeated close is a no-op')
  }
})

test('closing the maximized card clears only its maximize state, and closed cards stay gone after restore', () => {
  const survivor = { ...pane('b'), docked: true }
  const tree: ChatLayout = { kind: 'split', id: 'pair', axis: 'horizontal', ratio: 0.7,
    first: pane('a'), second: survivor }
  const next = dismissWindow({ tree, maximized: 'a', browserVisible: false }, 'a')
  assert.equal(next.maximized, undefined)
  assert.equal(next.tree, survivor)
  assert.deepEqual(initialWindowTree(next.tree, seed({ selectedPaneId: 'a' })), survivor)
  const empty = dismissWindow(next, 'b')
  assert.deepEqual(empty.tree, pane(BROWSER_PANE_ID))
  assert.deepEqual(initialWindowTree(empty.tree, seed({ selectedPaneId: 'b' })), empty.tree)
})
