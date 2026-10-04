import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, layoutGeometry, paneIds, readLayout, withBrowser, type ChatLayout } from './layout-tree.ts'
import { addTab, tabIds } from './layout-tabs.ts'
import { tileWindows } from './floating/window-arrange.ts'
import { GRID_CHAT_CAP, assignExpandedGroups, assignGroups, browserBetweenLayout, browserCentreLayout, browserSideLayout, chatStripLayout, fitExpandedWindowsTree, fitLayoutVariants, presetLayout, chooseGrid, clampGridCount, gridCapacity, gridLayout, sidebarStackForLead, sidebarStackLayout, singleGroup } from './layout-presets.ts'

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

test('chat, browser, chat puts the browser between two equal full-height chats', () => {
  const tree = browserBetweenLayout(groups(2), HD, ids())
  const geometry = layoutGeometry(tree, HD.width, HD.height)
  const rect = (id: string) => geometry.panes.find((pane) => pane.id === id)!.rect
  assert.deepEqual(geometry.panes.map((pane) => pane.id), ['c0', BROWSER_PANE_ID, 'c1'])
  assert.deepEqual(withBrowser(tree), tree)
  assert.ok([rect('c0'), rect('c1'), rect(BROWSER_PANE_ID)].every((box) => box.height === HD.height))
  assert.ok(Math.abs(rect('c0').width - rect('c1').width) <= 1)
  assert.ok(Math.abs(rect(BROWSER_PANE_ID).width - HD.width * 0.42) <= 1)
})

test('chats left, browser right gathers every window, floating and minimized too, into one tiled window', () => {
  const tree: ChatLayout = withBrowser({ kind: 'split', id: 's', axis: 'horizontal', ratio: 0.5,
    first: { kind: 'pane', id: 'a', float: { x: 0, y: 0, width: 400, height: 400, z: 1 }, onTop: true },
    second: { kind: 'pane', id: 'b', tabs: ['b', 'b2'], docked: true, dockNumber: 1 } })
  const merged = presetLayout({ kind: 'browser-side' }, assignGroups(tree, 1).groups, HD, ids())
  assert.deepEqual(merged, { kind: 'split', id: 'split-0', axis: 'horizontal', ratio: 0.6,
    first: { kind: 'pane', id: 'a', tabs: ['a', 'b', 'b2'] }, second: { kind: 'pane', id: BROWSER_PANE_ID } })
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

test('fit expanded windows tiles floats, skips minimized groups, and grids two chats without the browser', () => {
  const tree: ChatLayout = withBrowser({ kind: 'split', id: 's', axis: 'horizontal', ratio: 0.5,
    first: { kind: 'pane', id: 'a', float: { x: 0, y: 0, width: 400, height: 400, z: 1 } },
    second: { kind: 'pane', id: 'b', docked: true, dockNumber: 1 } })
  assert.deepEqual(assignExpandedGroups(tree).map((group) => group.active), ['a'])
  assert.equal(fitExpandedWindowsTree(tileWindows(tree), HD, false, 'a', ids()), null)
  const twoChats: ChatLayout = withBrowser({ kind: 'split', id: 's', axis: 'horizontal', ratio: 0.5,
    first: { kind: 'pane', id: 'left' }, second: { kind: 'pane', id: 'right', float: { x: 200, y: 200, width: 500, height: 500, z: 2 } } })
  const grid = fitExpandedWindowsTree(tileWindows(twoChats), HD, false, 'right', ids())!
  assert.deepEqual(paneIds(grid), ['right', 'left'])
  const geometry = layoutGeometry(grid, HD.width, HD.height)
  assert.equal(geometry.panes.length, 2)
})

test('fit expanded windows uses browser-between as the first two-window variant when the browser is visible', () => {
  const two: ChatLayout = withBrowser({ kind: 'split', id: 's', axis: 'horizontal', ratio: 0.5,
    first: { kind: 'pane', id: 'a' }, second: { kind: 'pane', id: 'b' } })
  const between = fitExpandedWindowsTree(two, HD, true, 'b', ids())!
  assert.deepEqual(geometryIds(between, HD), ['b', BROWSER_PANE_ID, 'a'])
})

test('fit expanded windows uses browser-three and browser-centre for three and four windows', () => {
  const threeTree: ChatLayout = withBrowser({ kind: 'split', id: 's', axis: 'horizontal', ratio: 0.5,
    first: { kind: 'pane', id: 'a' }, second: { kind: 'split', id: 't', axis: 'vertical', ratio: 0.5,
      first: { kind: 'pane', id: 'b' }, second: { kind: 'pane', id: 'c' } } })
  const three = fitExpandedWindowsTree(threeTree, HD, true, 'c', ids())!
  assert.deepEqual(geometryIds(three, HD), ['c', BROWSER_PANE_ID, 'a', 'b'])
  const fourTree: ChatLayout = withBrowser({ kind: 'split', id: 's', axis: 'horizontal', ratio: 0.5,
    first: { kind: 'split', id: 't', axis: 'vertical', ratio: 0.5,
      first: { kind: 'pane', id: 'a' }, second: { kind: 'pane', id: 'b' } },
    second: { kind: 'split', id: 'u', axis: 'vertical', ratio: 0.5,
      first: { kind: 'pane', id: 'c' }, second: { kind: 'pane', id: 'd' } } })
  const centre = fitExpandedWindowsTree(fourTree, HD, true, 'd', ids())!
  assert.deepEqual(geometryIds(centre, HD), ['d', 'a', BROWSER_PANE_ID, 'b', 'c'])
})

function geometryIds(tree: ChatLayout, size: typeof HD): string[] {
  return layoutGeometry(tree, size.width, size.height).panes.map((pane) => pane.id)
}

test('sidebarStackForLead puts the focus chat in the tall tile', () => {
  const four = groups(4)
  const tree = sidebarStackForLead(four, HD, 'c2', ids())!
  const lead = layoutGeometry(tree, HD.width, HD.height).panes.find((pane) => pane.id === 'c2')!.rect
  const stacked = layoutGeometry(tree, HD.width, HD.height).panes.find((pane) => pane.id === 'c0')!.rect
  assert.ok(lead.height > stacked.height)
  assert.ok(stacked.width > lead.width)
})

test('four chats without browser cycle grid, sidebar stack, and horizontal strip', () => {
  const four = groups(4)
  const variants = fitLayoutVariants(four, HD, false)
  assert.equal(variants.length, 3)
  const shapes = variants.map((build) => {
    const geometry = layoutGeometry(build(four, HD, ids()), HD.width, HD.height)
    const first = geometry.panes[0]!.rect
    return Math.round((first.width / first.height) * 100)
  })
  assert.equal(new Set(shapes).size, 3)
  const side = layoutGeometry(sidebarStackLayout(four, HD, ids()), HD.width, HD.height)
  const lead = side.panes.find((pane) => pane.id === 'c0')!.rect
  const stacked = side.panes.find((pane) => pane.id === 'c1')!.rect
  assert.ok(lead.height > stacked.height)
  assert.ok(stacked.width > lead.width)
  const row = layoutGeometry(chatStripLayout(four, HD, 'horizontal', ids()), HD.width, HD.height)
  assert.ok(row.panes.every((pane) => Math.abs(pane.rect.height - HD.height) <= 2))
})

test('fit layout variants alternate pair orientation and browser layouts', () => {
  const pair = groups(2)
  const noBrowser = fitLayoutVariants(pair, HD, false)
  assert.equal(noBrowser.length, 2)
  const h = layoutGeometry(noBrowser[0]!(pair, HD, ids()), HD.width, HD.height)
  const v = layoutGeometry(noBrowser[1]!(pair, HD, ids()), HD.width, HD.height)
  assert.ok(h.panes[0]!.rect.width < h.panes[0]!.rect.height)
  assert.ok(v.panes[0]!.rect.width > v.panes[0]!.rect.height)
  const withBrowser = fitLayoutVariants(pair, HD, true)
  assert.equal(withBrowser.length, 2)
  assert.notEqual(geometryIds(withBrowser[0]!(pair, HD, ids()), HD).join(),
    geometryIds(withBrowser[1]!(pair, HD, ids()), HD).join())
})
