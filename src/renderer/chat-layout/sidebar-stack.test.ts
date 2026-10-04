import assert from 'node:assert/strict'
import test from 'node:test'
import { appendSideChat, findSidebarStack, migrateSidebarStack, swapSidebarLead } from './sidebar-stack.js'
import { sidebarStackLayout, canUseSidebarStackLayout } from './layout-presets.js'
import { layoutGeometry, paneIds, readLayout, resizeSplit, saveLayout, withBrowser, type ChatLayout } from './layout-tree.js'
import { autoPlace } from './auto-place.js'
import { openTabInTree } from './layout-views.js'
import { applyLayoutGeometryDom } from './layout-geometry-dom.js'

const size = { width: 1920, height: 1014 }
const makeId = () => crypto.randomUUID()
const stack = (count = 4) => sidebarStackLayout(Array.from({ length: count }, (_, i) => ({ active: `c${i}`, tabs: [`c${i}`] })), size, makeId)

test('appending and reopening chats retain the lead, width, and existing side order', () => {
  let tree = stack()
  tree = resizeSplit(tree, tree.id, 0.43)
  const original = layoutGeometry(tree, size.width, size.height).panes[0]!.rect
  tree = autoPlace(tree, 'new', { ...size, browserVisible: false }, 'unused', 'c0')!
  tree = openTabInTree(tree, 'history', 'c0', 'unused')
  assert.deepEqual(paneIds(tree), ['c0', 'c1', 'c2', 'c3', 'new', 'history'])
  const geometry = layoutGeometry(tree, size.width, size.height)
  assert.deepEqual(geometry.panes[0]!.rect, original)
  assert.equal(geometry.minimum.height, 280)
  assert.equal(geometry.dividers.length, 1)
  assert.ok(geometry.scrollAreas[0]!.contentHeight > size.height)
  assert.ok(geometry.panes.every((pane) => pane.rect.height >= 280))
})

test('star exchanges only the chosen side slot and main slot without resetting the divider', () => {
  const tree = stack(7)
  const resized = resizeSplit(tree, tree.id, 0.41)
  const swapped = swapSidebarLead(resized, 'c4')!
  assert.deepEqual(paneIds(swapped), ['c4', 'c1', 'c2', 'c3', 'c0', 'c5', 'c6'])
  assert.equal(findSidebarStack(swapped)!.ratio, 0.41)
  assert.equal(findSidebarStack(swapped)!.id, resized.id)
  assert.deepEqual(swapSidebarLead(swapped, 'c0'), resized)
  assert.equal(swapSidebarLead(resized, 'missing'), null)
})

test('legacy stack migration preserves the user divider and does not convert a grid', () => {
  const original = stack()
  assert.equal(original.kind, 'split')
  if (original.kind !== 'split') return
  const legacy = { ...original, sidebarStack: undefined, ratio: 0.44 }
  const migrated = migrateSidebarStack(withBrowser(legacy))
  assert.equal(findSidebarStack(migrated)!.ratio, 0.44)
  const grid: ChatLayout = { ...legacy, first: legacy.second }
  assert.equal(findSidebarStack(migrateSidebarStack(grid)), null)
})

test('a large side stack saves and restores without the previous pane-count ceiling', () => {
  let tree = stack()
  for (let i = 4; i < 150; i++) tree = appendSideChat(tree, `c${i}`, makeId)!
  let saved = ''
  saveLayout({ setItem: (_key, value) => { saved = value } }, 'test', { tree, browserVisible: false })
  const restored = readLayout({ getItem: () => saved }, 'test')
  assert.deepEqual(restored.tree, tree)
  assert.equal(paneIds(restored.tree).length, 150)
  assert.equal(canUseSidebarStackLayout(150, size), true)
  const geometry = layoutGeometry(restored.tree, size.width, size.height)
  assert.equal(geometry.panes[0]!.rect.height, size.height)
  assert.equal(geometry.scrollAreas[0]!.paneIds.length, 149)
})

test('live divider resizing paints side viewport and locally positioned side cards', () => {
  const tree = stack(6)
  const geometry = layoutGeometry(tree, size.width, size.height, { [tree.id]: 0.45 })
  const area = geometry.scrollAreas[0]!
  const side = { style: {}, firstElementChild: { style: {} } }
  const tile = { style: {} }
  const canvas = { querySelector: (selector: string) => selector.includes('data-side-scroll') ? side
    : selector.includes('data-pane-id="c2"') ? tile : null } as unknown as HTMLElement
  applyLayoutGeometryDom(canvas, geometry)
  assert.equal((side.style as Record<string, string>).left, `${area.rect.x}px`)
  assert.equal((tile.style as Record<string, string>).left, '0px')
  assert.equal((tile.style as Record<string, string>).top, `${geometry.panes[2]!.rect.y - area.rect.y}px`)
})
