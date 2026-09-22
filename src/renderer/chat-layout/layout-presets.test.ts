import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, layoutGeometry, paneIds, readLayout, withBrowser, type ChatLayout } from './layout-tree.ts'
import { addTab, tabIds } from './layout-tabs.ts'
import { GRID_CHAT_CAP, assignGroups, browserCentreLayout, browserSideLayout, chooseGrid, clampGridCount, gridCapacity, gridLayout, singleGroup } from './layout-presets.ts'

const HD = { width: 1920, height: 1014 }
const QHD = { width: 2560, height: 1400 }
const ids = (): (() => string) => { let n = 0; return () => `split-${n++}` }
const groups = (count: number) => Array.from({ length: count }, (_, i) => singleGroup(`c${i}`))

test('grid choice prefers comfortable tiles, then squarer ones, and rejects what cannot fit', () => {
  assert.deepEqual(pick(chooseGrid(4, HD)), [2, 2])
  assert.deepEqual(pick(chooseGrid(6, HD)), [3, 2])
  assert.deepEqual(pick(chooseGrid(8, HD)), [4, 2])
  assert.deepEqual(pick(chooseGrid(6, QHD)), [3, 2])
  assert.deepEqual(pick(chooseGrid(2, { width: 1138, height: 1014 })), [2, 1])
  assert.equal(chooseGrid(10, { width: 1138, height: 1014 }), null)
  assert.equal(chooseGrid(1, { width: 200, height: 200 }), null)
})

test('capacity is the realistic cap or what fits, and counts clamp to it', () => {
  assert.equal(gridCapacity(HD), GRID_CHAT_CAP)
  assert.equal(gridCapacity({ width: 1138, height: 1014 }), 9)
  assert.equal(gridCapacity({ width: 200, height: 200 }), 1)
  assert.equal(clampGridCount(40, HD), GRID_CHAT_CAP)
  assert.equal(clampGridCount(0, HD), 1)
  assert.equal(clampGridCount(Number.NaN, HD), 1)
  assert.equal(clampGridCount(5.7, HD), 5)
})

test('grid tiles are equal within a row, rows are equal, and a short last row spreads out', () => {
  for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 12]) {
    const tree = gridLayout(groups(count), HD, ids())
    const geometry = layoutGeometry(tree, HD.width, HD.height)
    const grid = chooseGrid(count, HD)!
    assert.deepEqual(paneIds(tree), groups(count).map((group) => group.active))
    const rows = [...new Set(geometry.panes.map((pane) => Math.round(pane.rect.y)))]
    assert.equal(rows.length, grid.rows)
    for (const y of rows) {
      const row = geometry.panes.filter((pane) => Math.round(pane.rect.y) === y)
      const widths = row.map((pane) => Math.round(pane.rect.width))
      assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, `row ${y} widths ${widths.join(',')}`)
      assert.equal(Math.round(row[row.length - 1]!.rect.x + row[row.length - 1]!.rect.width), HD.width)
    }
    const heights = geometry.panes.map((pane) => Math.round(pane.rect.height))
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 1)
    assert.equal(Math.round(geometry.panes[geometry.panes.length - 1]!.rect.y + heights[0]!), HD.height)
  }
  const seven = layoutGeometry(gridLayout(groups(7), HD, ids()), HD.width, HD.height).panes
  assert.equal(seven.filter((pane) => pane.rect.y > 0).length, 3)
})

test('browser centre puts the browser between two stacked columns of equal chats', () => {
  const tree = browserCentreLayout(groups(4), HD, ids())
  const geometry = layoutGeometry(tree, HD.width, HD.height)
  const rect = (id: string) => geometry.panes.find((pane) => pane.id === id)!.rect
  assert.deepEqual(paneIds(tree), ['c0', 'c1', 'c2', 'c3'])
  assert.deepEqual(withBrowser(tree), tree)
  assert.equal(rect(BROWSER_PANE_ID).height, HD.height)
  assert.ok(rect('c0').x + rect('c0').width < rect(BROWSER_PANE_ID).x)
  assert.ok(rect(BROWSER_PANE_ID).x + rect(BROWSER_PANE_ID).width < rect('c2').x)
  assert.equal(rect('c0').x, rect('c1').x)
  assert.equal(rect('c2').x, rect('c3').x)
  assert.ok(rect('c1').y > rect('c0').y && rect('c3').y > rect('c2').y)
  assert.ok(Math.abs(rect('c0').width - rect('c2').width) <= 1)
  assert.ok(Math.abs(rect('c0').height - rect('c1').height) <= 1)
  assert.ok(Math.abs(rect(BROWSER_PANE_ID).width - HD.width * 0.42) <= 1)
  assert.deepEqual(readLayout({ getItem: () => JSON.stringify({ tree, browserVisible: true }) }, '/a').tree, tree)
})

test('browser side puts one chat beside the full-height browser', () => {
  const tree = browserSideLayout(groups(1), ids())
  const geometry = layoutGeometry(tree, HD.width, HD.height)
  const rect = (id: string) => geometry.panes.find((pane) => pane.id === id)!.rect
  assert.deepEqual(paneIds(tree), ['c0'])
  assert.deepEqual(withBrowser(tree), tree)
  assert.equal(rect('c0').height, HD.height)
  assert.equal(rect(BROWSER_PANE_ID).height, HD.height)
  assert.ok(rect('c0').x + rect('c0').width < rect(BROWSER_PANE_ID).x)
  assert.deepEqual(readLayout({ getItem: () => JSON.stringify({ tree, browserVisible: true }) }, '/a').tree, tree)
})

test('groups keep their tabs in tile order, overflow merges into the last slot, shortfall is counted', () => {
  const left = addTab({ kind: 'pane', id: 'a' }, 'a', 'a2')
  const tree: ChatLayout = withBrowser({ kind: 'split', id: 's', axis: 'horizontal', ratio: 0.5,
    first: left, second: { kind: 'split', id: 't', axis: 'vertical', ratio: 0.5,
      first: { kind: 'pane', id: 'b' }, second: { kind: 'pane', id: 'c', tabs: ['c0', 'c'] } } })
  assert.deepEqual(assignGroups(tree, 4), { groups: [{ active: 'a2', tabs: ['a', 'a2'] }, singleGroup('b'), { active: 'c', tabs: ['c0', 'c'] }], missing: 1 })
  assert.deepEqual(assignGroups(tree, 2), { groups: [{ active: 'a2', tabs: ['a', 'a2'] }, { active: 'b', tabs: ['b', 'c0', 'c'] }], missing: 0 })
  assert.deepEqual(assignGroups(null, 2), { groups: [], missing: 2 })
  const merged = gridLayout(assignGroups(tree, 2).groups, HD, ids())
  assert.deepEqual(paneIds(merged), ['a2', 'b'])
  assert.deepEqual(tabIds(merged), ['a', 'a2', 'b', 'c0', 'c'])
  assert.deepEqual(readLayout({ getItem: () => JSON.stringify({ tree: merged, browserVisible: false }) }, '/a').tree, merged)
})

function pick(grid: ReturnType<typeof chooseGrid>): [number, number] | null {
  return grid && [grid.cols, grid.rows]
}
