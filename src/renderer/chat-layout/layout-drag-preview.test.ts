import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, dockPane, layoutGeometry, removePane, withBrowser, type ChatLayout } from './layout-tree.ts'
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
      const preview: ReturnType<typeof layoutGeometry> = dragSplitPreview(tree, source, { target: 'a', edge }, true, 1000, 800)!
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

test('chat split choices hold across diagonals until movement is deliberate', () => {
  const panes = [{ id: 'a', rect: { x: 0, y: 0, width: 1000, height: 800 } }]
  let held = chatDropAt(panes, 250, 210)!
  assert.equal(held.edge, 'left')
  for (const y of [198, 205, 185, 201]) {
    held = chatDropAt(panes, 250, y, held)!
    assert.equal(held.edge, 'left')
  }
  held = chatDropAt(panes, 250, 150, held)!
  assert.equal(held.edge, 'top')
  assert.equal(chatDropAt(panes, 250, 210, held)?.edge, 'top')
  assert.equal(chatDropAt(panes, 250, 250, held)?.edge, 'left')
  assert.equal(chatDropAt(panes, -1, 250, held), null)
})

test('tab merging has separate entry and exit boundaries', () => {
  const panes = [{ id: 'a', rect: { x: 0, y: 0, width: 1000, height: 800 } }]
  const split = chatDropAt(panes, 500, 100)!
  assert.equal(chatDropAt(panes, 500, 32, split)?.edge, 'top')
  const strip = chatDropAt(panes, 500, 20, split)!
  assert.equal(strip.edge, null)
  assert.equal(chatDropAt(panes, 500, 45, strip)?.edge, null)
  assert.equal(chatDropAt(panes, 500, 55, strip)?.edge, 'top')
})

test('browser halves hold near their midpoint but a different tile switches immediately', () => {
  const panes = [
    { id: BROWSER_PANE_ID, rect: { x: 0, y: 0, width: 600, height: 800 } },
    { id: 'a', rect: { x: 606, y: 0, width: 600, height: 800 } }
  ]
  const left = chatDropAt(panes, 290, 400)!
  assert.equal(chatDropAt(panes, 320, 400, left)?.edge, 'left')
  assert.equal(chatDropAt(panes, 340, 400, left)?.edge, 'right')
  assert.equal(chatDropAt(panes, 610, 400, left)?.target, 'a')
  assert.equal(chatDropAt(panes, 603, 400, left), null)
})

for (const singleTab of [false, true]) {
  test(`hidden browser leaves three full-height chat columns during ${singleTab ? 'tab' : 'pane'} drag`, () => {
    const stacked: ChatLayout = { kind: 'split', id: 'stack', axis: 'vertical', ratio: 0.5,
      first: { kind: 'pane', id: 'b' }, second: { kind: 'pane', id: 'c' } }
    // Browser nested beside the source also exercises collapse of its saved split.
    const tree: ChatLayout = { ...pair, second: { ...stacked, second: withBrowser(stacked.second) } }
    const drop = { target: 'a', edge: 'right' as const }
    const preview = dragSplitPreview(tree, 'c', drop, singleTab, 1500, 900, false)!
    assert.equal(preview.panes.length, 3)
    assert.ok(preview.panes.every(({ id, rect }) => id !== BROWSER_PANE_ID && rect.y === 0 && rect.height === 900))
    assert.equal(Math.max(...preview.panes.map(({ rect }) => rect.x + rect.width)), 1500)
    const committed = removePane(dockPane(tree, 'c', 'a', 'right', 'committed'), BROWSER_PANE_ID)!
    assert.deepEqual(preview.panes, layoutGeometry(committed, 1500, 900).panes)
    assert.equal(preview.dividers.length, 2)
    const visible = dragSplitPreview(tree, 'c', drop, singleTab, 1500, 900, true)!
    assert.ok(visible.panes.some(({ id }) => id === BROWSER_PANE_ID))
  })
}
