import assert from 'node:assert/strict'
import test from 'node:test'
import { dockPane, layoutGeometry, paneIds, readLayout, resizeSplit, saveLayout, type ChatLayout } from './layout-tree.ts'
import { addTab, pruneTabs, removeTab, selectTab, tabIds } from './layout-tabs.ts'

const split = (): ChatLayout => resizeSplit(dockPane({ kind: 'pane', id: 'a' }, 'b', 'a', 'right', 'split'), 'split', 0.6)

test('new tabs keep each tile independent and preserve divider geometry', () => {
  let tree = split()
  const before = layoutGeometry(tree, 1000, 700).panes.map((pane) => pane.rect)
  tree = addTab(tree, 'a', 'c')
  tree = addTab(tree, 'b', 'd')
  assert.deepEqual(paneIds(tree), ['c', 'd'])
  assert.deepEqual(tabIds(tree), ['a', 'c', 'b', 'd'])
  assert.deepEqual(layoutGeometry(tree, 1000, 700).panes.map((pane) => pane.rect), before)
  tree = selectTab(tree, 'd', 'a')
  assert.deepEqual(paneIds(tree), ['a', 'd'])
  assert.deepEqual(tabIds(tree), ['a', 'c', 'b', 'd'])
  tree = selectTab(tree, 'a', 'history')
  assert.deepEqual(tabIds(tree), ['history', 'c', 'b', 'd'])
})

test('closing tabs selects a neighbor, pruning archives preserves siblings, moving a tile carries tabs', () => {
  let tree = addTab(addTab(split(), 'a', 'c'), 'c', 'e')
  tree = removeTab(tree, 'c')!
  assert.deepEqual(paneIds(tree), ['e', 'b'])
  tree = removeTab(tree, 'e')!
  assert.deepEqual(paneIds(tree), ['a', 'b'])
  tree = addTab(tree, 'a', 'f')
  tree = dockPane(tree, 'f', 'b', 'bottom', 'moved')
  assert.deepEqual(tabIds(tree), ['b', 'a', 'f'])
  tree = pruneTabs(tree, new Set(['b', 'a']))!
  assert.deepEqual(paneIds(tree), ['b', 'a'])
  tree = removeTab(tree, 'b')!
  assert.equal(tree.kind, 'pane')
  assert.equal(removeTab(tree, 'a'), null)
})

test('tab order and active selection survive project-scoped persistence and invalid tabs are rejected', () => {
  const saved = new Map<string, string>()
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) } }
  const tree = selectTab(addTab(split(), 'a', 'c'), 'c', 'a')
  saveLayout(storage, '/project', { tree, browserVisible: false })
  assert.deepEqual(readLayout(storage, '/project'), { tree, browserVisible: false })
  assert.equal(readLayout(storage, '/other').tree, null)
  for (const invalid of [
    { kind: 'pane', id: 'a', tabs: ['b'] },
    { kind: 'pane', id: 'a', tabs: ['a', 'a'] },
    { kind: 'pane', id: 'a', tabs: ['a', 1] },
    { kind: 'split', id: 's', ratio: 0.5, axis: 'horizontal', first: { kind: 'pane', id: 'a', tabs: ['a', 'b'] }, second: { kind: 'pane', id: 'b' } }
  ]) assert.equal(readLayout({ getItem: () => JSON.stringify({ tree: invalid, browserVisible: true }) }, '/project').tree, null)
})
