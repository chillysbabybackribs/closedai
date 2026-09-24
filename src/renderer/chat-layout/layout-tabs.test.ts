import assert from 'node:assert/strict'
import test from 'node:test'
import { dockPane, layoutGeometry, paneIds, readLayout, resizeSplit, saveLayout, withBrowser, type ChatLayout } from './layout-tree.ts'
import { addTab, focusedCloseAction, focusChatTabInLayout, isChatTabActive, moveTab, neighborTile, pruneTabs, removeTab, selectTab, tabIds } from './layout-tabs.ts'
import { viewTabId } from './layout-views.ts'

const split = (): ChatLayout => resizeSplit(dockPane({ kind: 'pane', id: 'a' }, 'b', 'a', 'right', 'split'), 'split', 0.6)

test('active and inactive tabs split out of their own group on every edge', () => {
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    for (const id of ['a', 'c']) {
      const tree = moveTab(addTab({ kind: 'pane', id: 'a' }, 'a', 'c'), id, 'c', edge, 'new')
      assert.equal(tree.kind, 'split')
      assert.equal(new Set(tabIds(tree)).size, 2)
      assert.equal(paneIds(tree).length, 2)
      const panes = layoutGeometry(tree, 1000, 800).panes
      if (edge === 'left' || edge === 'right') assert.ok(panes.every((pane) => pane.rect.height === 800))
      else assert.ok(panes.every((pane) => pane.rect.width === 1000))
      assert.equal(panes[edge === 'left' || edge === 'top' ? 0 : 1]!.id, id)
    }
  }
})

test('moving a tab between groups preserves siblings and collapses only an empty source', () => {
  let tree = addTab(split(), 'a', 'c')
  tree = moveTab(tree, 'c', 'b', null, 'unused')
  assert.deepEqual(paneIds(tree), ['a', 'c'])
  assert.deepEqual(tabIds(tree), ['a', 'b', 'c'])
  assert.equal(tree.kind === 'split' && tree.ratio, 0.6)
  tree = moveTab(tree, 'a', 'c', null, 'unused')
  assert.equal(tree.kind, 'pane')
  assert.deepEqual(tabIds(tree), ['b', 'c', 'a'])
  assert.deepEqual(paneIds(tree), ['a'])
  const alone: ChatLayout = { kind: 'pane', id: 'a' }
  assert.equal(moveTab(alone, 'a', 'a', 'right', 'unused'), alone)
  assert.equal(moveTab(tree, 'a', 'missing', 'bottom', 'unused'), tree)
})

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
  assert.deepEqual(tabIds(tree), ['a', 'c', 'history', 'b', 'd'])
  assert.deepEqual(paneIds(tree), ['history', 'd'])
  assert.deepEqual(layoutGeometry(tree, 1000, 700).panes.map((pane) => pane.rect), before)
})

test('history opens preserve existing tabs and browser geometry, and reuse tabs across tiles', () => {
  const original = withBrowser(addTab(split(), 'a', 'draft'))
  const before = layoutGeometry(original, 1400, 900).panes.map((pane) => pane.rect)
  let tree = selectTab(original, 'draft', 'history')
  assert.deepEqual(tabIds(original), ['a', 'draft', 'b'])
  assert.deepEqual(tabIds(tree), ['a', 'draft', 'history', 'b'])
  tree = selectTab(tree, 'history', 'older-history')
  assert.deepEqual(tabIds(tree), ['a', 'draft', 'history', 'older-history', 'b'])
  tree = selectTab(tree, 'older-history', 'b')
  tree = selectTab(tree, 'b', 'history')
  assert.deepEqual(tabIds(tree), ['a', 'draft', 'history', 'older-history', 'b'])
  assert.deepEqual(paneIds(tree), ['history', 'b'])
  assert.deepEqual(layoutGeometry(tree, 1400, 900).panes.map((pane) => pane.rect), before)
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

test('focused close matches the tab control: sibling, spare tile, or last chat', () => {
  const tabs: ChatLayout = { kind: 'pane', id: 'a', tabs: ['a', 'b'] }
  assert.equal(focusedCloseAction(tabs, 'b'), 'close-tab')
  assert.equal(focusedCloseAction(split(), 'a'), 'hide-pane')
  assert.equal(focusedCloseAction({ kind: 'pane', id: 'a' }, 'a'), null)
  assert.equal(focusedCloseAction(tabs, 'missing'), null)
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

test('neighborTile walks tiles in reading order from any tab and wraps', () => {
  // Tiles read d (active over a), b, c; an inactive tab resolves through its tile.
  const tree = addTab(dockPane(split(), 'c', 'b', 'bottom', 'lower'), 'a', 'd')
  assert.equal(neighborTile(tree, 'a', 'next'), 'b')
  assert.equal(neighborTile(tree, 'd', 'next'), 'b')
  assert.equal(neighborTile(tree, 'b', 'next'), 'c')
  assert.equal(neighborTile(tree, 'c', 'next'), 'd')
  assert.equal(neighborTile(tree, 'a', 'previous'), 'c')
  assert.equal(neighborTile(tree, 'b', 'previous'), 'd')
})

test('neighborTile is null for a lone tile, the browser, or an unknown tab', () => {
  assert.equal(neighborTile(addTab({ kind: 'pane', id: 'a' }, 'a', 'b'), 'a', 'next'), null)
  assert.equal(neighborTile(withBrowser({ kind: 'pane', id: 'a' }), 'a', 'next'), null)
  assert.equal(neighborTile(split(), 'zzz', 'next'), null)
})

test('moving a tab to the neighbouring tile joins its strip and collapses an emptied tile', () => {
  const tree = addTab(split(), 'a', 'c')
  const moved = moveTab(tree, 'c', neighborTile(tree, 'c', 'next')!, null, 'x')
  assert.deepEqual(paneIds(moved).sort(), ['a', 'c'])
  assert.equal(tabIds(moved).length, 3)
  const lone = moveTab(split(), 'a', neighborTile(split(), 'a', 'next')!, null, 'x')
  assert.equal(lone.kind, 'pane')
  assert.deepEqual(tabIds(lone), ['b', 'a'])
})

test('isChatTabActive is true only for the visible tab in a tile', () => {
  const tree = addTab({ kind: 'pane', id: 'a' }, 'a', 'b')
  assert.equal(isChatTabActive(tree, 'b'), true)
  assert.equal(isChatTabActive(tree, 'a'), false)
  const focused = selectTab(tree, 'a', 'a')
  assert.equal(isChatTabActive(focused, 'a'), true)
  assert.equal(isChatTabActive(focused, 'b'), false)
})

test('focusChatTabInLayout surfaces a chat covered by a history view tab', () => {
  const history = viewTabId('history', 'view-1')
  let tree = addTab({ kind: 'pane', id: 'a' }, 'a', 'draft')
  tree = selectTab(tree, 'draft', history)
  assert.equal(isChatTabActive(tree, 'a'), false)
  tree = focusChatTabInLayout(tree, 'a')
  assert.equal(isChatTabActive(tree, 'a'), true)
  assert.ok(tabIds(tree).includes(history))
})
