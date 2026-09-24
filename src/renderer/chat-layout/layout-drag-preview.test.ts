import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, layoutGeometry, withBrowser, type ChatLayout } from './layout-tree.ts'
import { chatDropAt, dragPreviewPanes, dragSplitPreview } from './layout-drag-preview.ts'

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

for (const source of ['a', 'b']) {
  test(`splitting tab ${source} renders both conversations, with the committed shell kept first`, () => {
    const tree: ChatLayout = { kind: 'pane', id: 'a', tabs: ['a', 'b'] }
    const committed = layoutGeometry(tree, 1000, 800).panes
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      const preview = dragSplitPreview(tree, source, { target: 'a', edge }, true, 1000, 800)!
      const rendered = dragPreviewPanes(committed, preview)
      assert.deepEqual(rendered.map((pane) => pane.id), ['a', 'b'])
      for (const pane of rendered) {
        assert.deepEqual(pane, preview.panes.find((next) => next.id === pane.id))
        assert.deepEqual(pane.tabs, [pane.id])
        assert.ok(pane.rect.width > 0 && pane.rect.height > 0)
      }
    }
    assert.equal(dragPreviewPanes(committed, null), committed)
  })
}

test('chat hit targets use original geometry through preview and release', () => {
  const tree: ChatLayout = { kind: 'pane', id: 'a', tabs: ['a', 'b'] }
  const panes = layoutGeometry(tree, 1000, 800).panes
  const target = chatDropAt(panes, 950, 400)!
  assert.deepEqual(target, { target: 'a', edge: 'right' })
  const preview = dragSplitPreview(tree, 'b', target, true, 1000, 800)!
  assert.equal(chatDropAt(preview.panes, 950, 400)?.target, 'b')
  assert.deepEqual(chatDropAt(panes, 950, 400), target)
  assert.deepEqual(chatDropAt(panes, 500, 20), { target: 'a', edge: null })
  assert.equal(chatDropAt(panes, -1, 400), null)
})
