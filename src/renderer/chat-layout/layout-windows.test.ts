import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatLayout } from './layout-tree.js'
import { tabIds } from './layout-tabs.js'
import { adoptTabs, initialWindowTree, type WindowTreeSeed } from './layout-windows.js'

const seed = (patch: Partial<WindowTreeSeed>): WindowTreeSeed => ({
  available: new Set(['a', 'b', 'c']), elsewhere: new Set(), selectedPaneId: 'a', detached: false,
  initialTabs: [], fallbackView: () => 'closedai:view:history:x', ...patch
})
const pane = (id: string, tabs?: string[]): ChatLayout => ({ kind: 'pane', id, ...(tabs ? { tabs } : {}) })

test('the main window drops chats another window holds and never pulls one forward', () => {
  const tree = initialWindowTree(pane('a', ['a', 'b']), seed({ elsewhere: new Set(['b']), selectedPaneId: 'b' }))
  assert.deepEqual(tabIds(tree), ['a'])
})

test('the main window still adds its own selected chat', () => {
  assert.deepEqual(tabIds(initialWindowTree(pane('a'), seed({ selectedPaneId: 'c' }))), ['a', 'c'])
})

test('a new detached window opens with the tabs moved into it, ignoring the selection', () => {
  const tree = initialWindowTree(null, seed({ detached: true, initialTabs: ['b', 'closedai:view:trace:1'], selectedPaneId: 'a' }))
  assert.deepEqual(tree, { kind: 'pane', id: 'b', tabs: ['b', 'closedai:view:trace:1'] })
})

test('a detached window whose chats are gone shows the history view', () => {
  const tree = initialWindowTree(null, seed({ detached: true, initialTabs: ['gone'] }))
  assert.deepEqual(tree, { kind: 'pane', id: 'closedai:view:history:x' })
})

test('a main window whose only chat moved away opens on the history view, not on that chat', () => {
  const tree = initialWindowTree(pane('b'), seed({ elsewhere: new Set(['b']), selectedPaneId: 'b' }))
  assert.deepEqual(tree, { kind: 'pane', id: 'closedai:view:history:x' })
})

test('handed-back tabs join the anchor tile once, and a second Agents view is skipped', () => {
  const tree: ChatLayout = { kind: 'split', id: 's', axis: 'horizontal', ratio: 0.5,
    first: pane('a'), second: pane('closedai:view:agents:1') }
  const next = adoptTabs(tree, ['b', 'a', 'closedai:view:agents:2'], 'a')
  assert.deepEqual(tabIds(next), ['a', 'b', 'closedai:view:agents:1'])
})
