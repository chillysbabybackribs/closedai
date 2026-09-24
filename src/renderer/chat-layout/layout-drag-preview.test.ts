import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, layoutGeometry, withBrowser, type ChatLayout } from './layout-tree.ts'
import { dragSplitPreview } from './layout-drag-preview.ts'

const pair: ChatLayout = {
  kind: 'split',
  id: 'ab',
  axis: 'horizontal',
  ratio: 0.5,
  first: { kind: 'pane', id: 'a' },
  second: { kind: 'pane', id: 'b' }
}

test('dragSplitPreview resizes sibling chats while dragging a pane to split', () => {
  const atRest = layoutGeometry(pair, 800, 600)
  const preview = dragSplitPreview(pair, 'a', { target: 'b', edge: 'bottom' }, false, 800, 600)
  assert.ok(preview)
  assert.notEqual(
    atRest.panes.find((pane) => pane.id === 'b')!.rect.height,
    preview!.panes.find((pane) => pane.id === 'b')!.rect.height
  )
})

test('dragSplitPreview matches browser dock preview geometry', () => {
  const tree = withBrowser(pair)
  const preview = dragSplitPreview(tree, BROWSER_PANE_ID, { target: 'a', edge: 'top' }, false, 1600, 900)
  assert.ok(preview)
  assert.equal(preview!.panes.find((pane) => pane.id === 'b')!.rect.height, 900)
})

test('dragSplitPreview returns null for tab-strip drops', () => {
  assert.equal(dragSplitPreview(pair, 'a', { target: 'b', edge: null }, true, 800, 600), null)
})

test('dragSplitPreview materializes a second tile when a tab splits out of a group', () => {
  const grouped = { kind: 'pane' as const, id: 'a', tabs: ['a', 'b'] }
  const preview = dragSplitPreview(grouped, 'b', { target: 'a', edge: 'right' }, true, 800, 600)
  assert.ok(preview)
  assert.equal(preview!.panes.length, 2)
  assert.deepEqual(preview!.panes.map((pane) => pane.id).sort(), ['a', 'b'])
})
