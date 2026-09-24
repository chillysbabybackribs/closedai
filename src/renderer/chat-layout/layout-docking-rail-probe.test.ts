import assert from 'node:assert/strict'
import test from 'node:test'
import { setGroupDocked, DOCK_HEIGHT } from './layout-docking.ts'
import { BROWSER_PANE_ID, dockPane, layoutGeometry, withBrowser, type ChatLayout } from './layout-tree.ts'
import { browserCentreLayout, singleGroup } from './layout-presets.ts'

const pane = (id: string): ChatLayout => ({ kind: 'pane', id })
const split = (id: string, first: ChatLayout, second: ChatLayout, axis: 'horizontal' | 'vertical' = 'horizontal'): ChatLayout =>
  ({ kind: 'split', id, first, second, axis, ratio: 0.5 })

test('probe horizontal pair rail width', () => {
  const tree = split('row', pane('a'), pane('b'))
  const docked = setGroupDocked(tree, 'b', true)
  const g = layoutGeometry(docked, 1800, 900)
  assert.equal(g.rails.length, 1)
  assert.equal(g.rails[0]!.rect.width, 1800)
  const pa = g.panes.find((p) => p.id === 'a')!
  assert.equal(pa.rect.height, 900 - DOCK_HEIGHT)
})

test('probe browser centre left column dock', () => {
  const groups = [singleGroup('a'), singleGroup('b'), singleGroup('c'), singleGroup('d')]
  const tree = withBrowser(browserCentreLayout(groups, { width: 1800, height: 900 }, () => 'id'))
  const docked = setGroupDocked(setGroupDocked(tree, 'b', true), 'd', true)
  const g = layoutGeometry(docked, 1800, 900)
  console.log('rails', g.rails.map((r) => ({ id: r.id, rect: r.rect, groups: r.groups.map((x) => x.id) })))
  console.log('panes', g.panes.map((p) => ({ id: p.id, rect: p.rect })))
})

test('probe horizontal pair both visible one docked no browser', () => {
  const tree = split('row', pane('a'), pane('b'))
  const docked = setGroupDocked(tree, 'b', true)
  const g = layoutGeometry(docked, 1800, 900)
  console.log('no browser rails', g.rails[0]?.rect)
  console.log('pane a', g.panes.find((p) => p.id === 'a')?.rect)
})

test('probe two visible horizontal with one docked beside browser', () => {
  const left = split('left', pane('a'), pane('b'))
  const tree = split('outer', left, { kind: 'pane', id: BROWSER_PANE_ID })
  const docked = setGroupDocked(tree, 'a', true)
  const g = layoutGeometry(docked, 1800, 900)
  console.log('rails', g.rails)
  console.log('panes', g.panes.map((p) => ({ id: p.id, rect: p.rect })))
})
