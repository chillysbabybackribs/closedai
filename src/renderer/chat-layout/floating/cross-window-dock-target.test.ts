import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatLayout } from '../layout-tree.ts'
import { resolveCrossDockTarget } from './cross-window-dock-target.ts'
import { targetPreview } from './window-targets.ts'

const canvas = { width: 1200, height: 800 }
const tiled = [{ id: 'a', rect: { x: 0, y: 0, width: 1200, height: 800 } }]

test('cross-window body center stacks below the target tile', () => {
  assert.deepEqual(
    resolveCrossDockTarget('incoming', { x: 600, y: 500 }, canvas, tiled, []),
    { kind: 'split', target: 'a', edge: 'bottom' }
  )
})

test('cross-window body over a floating chat tile still shows a split target', () => {
  const floating = [{ id: 'a', rect: { x: 80, y: 60, width: 520, height: 640 } }]
  assert.deepEqual(
    resolveCrossDockTarget('incoming', { x: 300, y: 400 }, canvas, [], floating),
    { kind: 'split', target: 'a', edge: 'bottom' }
  )
})

test('cross-window pointer in canvas gap snaps to the nearest chat tile', () => {
  const floating = [{ id: 'a', rect: { x: 80, y: 60, width: 520, height: 640 } }]
  assert.deepEqual(
    resolveCrossDockTarget('incoming', { x: 700, y: 400 }, canvas, [], floating),
    { kind: 'split', target: 'a', edge: 'right' }
  )
})

test('split preview uses the incoming pane id before it exists on the tree', () => {
  const tree: ChatLayout = { kind: 'pane', id: 'a', tabs: ['a'] }
  const target = { kind: 'split' as const, target: 'a', edge: 'bottom' as const }
  const rect = targetPreview(tree, 'incoming', target, canvas, false, tiled, [])
  assert.ok(rect && rect.height < 800)
})
