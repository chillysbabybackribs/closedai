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

test('split preview uses the incoming pane id before it exists on the tree', () => {
  const tree: ChatLayout = { kind: 'pane', id: 'a', tabs: ['a'] }
  const target = { kind: 'split' as const, target: 'a', edge: 'bottom' as const }
  const rect = targetPreview(tree, 'incoming', target, canvas, false, tiled, [])
  assert.ok(rect && rect.height < 800)
})
