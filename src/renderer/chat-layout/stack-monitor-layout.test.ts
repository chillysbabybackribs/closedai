import assert from 'node:assert/strict'
import test from 'node:test'
import { sidebarStackLayout } from './layout-presets.js'
import { layoutGeometry } from './layout-tree.js'
import { canPromoteStackMonitorLead, paneTileHeight, shouldPromoteStackMonitorSelection } from './stack-monitor-layout.js'

const HD = { width: 1920, height: 1014 }
const groups = (n: number) => Array.from({ length: n }, (_, i) => ({ active: `c${i}`, tabs: [`c${i}`] }))
const ids = (): (() => string) => { let n = 0; return () => `split-${n++}` }

test('shouldPromoteStackMonitorSelection is false for the tall lead tile', () => {
  const tree = sidebarStackLayout(groups(4), HD, ids())
  const leadHeight = paneTileHeight(tree, HD, 'c0')
  assert.ok(leadHeight! > 400)
  assert.equal(shouldPromoteStackMonitorSelection(leadHeight, 4, HD), false)
})

test('shouldPromoteStackMonitorSelection is true for a stacked tile', () => {
  const tree = sidebarStackLayout(groups(4), HD, ids())
  const stackHeight = paneTileHeight(tree, HD, 'c1')
  assert.ok(stackHeight! <= 400)
  assert.equal(shouldPromoteStackMonitorSelection(stackHeight, 4, HD), true)
})

test('paneTileHeight resolves tab owners to their tile', () => {
  const tree = sidebarStackLayout(groups(3), HD, ids())
  const h = paneTileHeight(tree, HD, 'c2')
  assert.equal(h, layoutGeometry(tree, HD.width, HD.height).panes.find((p) => p.id === 'c2')!.rect.height)
})

test('canPromoteStackMonitorLead matches geometry for stack tiles only', () => {
  const tree = sidebarStackLayout(groups(4), HD, ids())
  assert.equal(canPromoteStackMonitorLead(tree, HD, 'c0', 4), false)
  assert.equal(canPromoteStackMonitorLead(tree, HD, 'c2', 4), true)
  assert.equal(canPromoteStackMonitorLead(tree, HD, 'c2', 2), false)
})
