import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, type ChatLayout } from '../layout-tree.ts'
import { floatWindow } from './window-layout.ts'
import { sameTarget, targetPreview, windowTargetAt } from './window-targets.ts'

const canvas = { width: 1200, height: 800 }
const tiled = [{ id: 'a', rect: { x: 0, y: 0, width: 600, height: 800 } }, { id: BROWSER_PANE_ID, rect: { x: 614, y: 0, width: 586, height: 800 } }]
const floating = [{ id: 'f', rect: { x: 200, y: 200, width: 400, height: 300 } }]

test('workspace edges snap a column, the top maximizes', () => {
  assert.deepEqual(windowTargetAt('m', 5, 400, canvas, tiled, floating), { kind: 'split', target: WORKSPACE_DOCK_ID, edge: 'left' })
  assert.deepEqual(windowTargetAt('m', 1195, 400, canvas, tiled, floating), { kind: 'split', target: WORKSPACE_DOCK_ID, edge: 'right' })
  assert.deepEqual(windowTargetAt('m', 600, -30, canvas, tiled, floating), { kind: 'maximize' })
})

test('a tab strip groups, an outer band splits, the middle floats', () => {
  assert.deepEqual(windowTargetAt('m', 300, 20, canvas, tiled, []), { kind: 'group', target: 'a' })
  assert.deepEqual(windowTargetAt('m', 300, 780, canvas, tiled, []), { kind: 'split', target: 'a', edge: 'bottom' })
  assert.deepEqual(windowTargetAt('m', 580, 400, canvas, tiled, []), { kind: 'split', target: 'a', edge: 'right' })
  assert.deepEqual(windowTargetAt('m', 300, 400, canvas, tiled, []), { kind: 'free' })
})

test('a floating window hides what lies under it; the browser never groups', () => {
  assert.deepEqual(windowTargetAt('m', 300, 210, canvas, tiled, floating), { kind: 'group', target: 'f' })
  assert.deepEqual(windowTargetAt('m', 210, 480, canvas, tiled, floating), { kind: 'free' }, 'the tiled band under it is covered')
  assert.deepEqual(windowTargetAt('m', 900, 20, canvas, tiled, []), { kind: 'split', target: BROWSER_PANE_ID, edge: 'top' }, 'the browser strip stacks above it')
  assert.deepEqual(windowTargetAt(BROWSER_PANE_ID, 300, 20, canvas, tiled, []), { kind: 'split', target: 'a', edge: 'top' })
  assert.deepEqual(windowTargetAt('f', 300, 210, canvas, tiled, floating), { kind: 'free' }, 'never its own strip')
})

test('previews show the landing rect or the window joined', () => {
  const tree: ChatLayout = floatWindow({ kind: 'split', id: 's', axis: 'horizontal', ratio: 0.5,
    first: { kind: 'pane', id: 'a' }, second: { kind: 'pane', id: 'm' } }, 'm', { x: 10, y: 10, width: 400, height: 300 })
  const column = targetPreview(tree, 'm', { kind: 'split', target: WORKSPACE_DOCK_ID, edge: 'right' }, canvas, false, tiled)
  assert.deepEqual(column, { x: 607, y: 0, width: 593, height: 800 })
  assert.deepEqual(targetPreview(tree, 'm', { kind: 'group', target: 'a' }, canvas, false, tiled), tiled[0]!.rect)
  assert.deepEqual(targetPreview(tree, 'm', { kind: 'maximize' }, canvas, false, tiled), { x: 0, y: 0, width: 1200, height: 800 })
  assert.equal(targetPreview(tree, 'm', { kind: 'free' }, canvas, false, tiled), null)
  assert.ok(sameTarget({ kind: 'group', target: 'a' }, { kind: 'group', target: 'a' }))
  assert.ok(!sameTarget({ kind: 'split', target: 'a', edge: 'left' }, { kind: 'split', target: 'a', edge: 'right' }))
})
