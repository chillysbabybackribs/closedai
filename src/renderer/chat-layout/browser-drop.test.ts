import assert from 'node:assert/strict'
import test from 'node:test'
import { browserDropAt, browserDropPreview } from './browser-drop.ts'
import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, layoutGeometry, type ChatLayout } from './layout-tree.ts'

const tree: ChatLayout = {
  kind: 'split', id: 'outer', axis: 'horizontal', ratio: 0.65,
  first: { kind: 'split', id: 'chats', axis: 'horizontal', ratio: 0.5,
    first: { kind: 'pane', id: 'a' }, second: { kind: 'pane', id: 'b' } },
  second: { kind: 'pane', id: BROWSER_PANE_ID }
}
const panes = layoutGeometry(tree, 1600, 900).panes

test('browser targets all four edges of either chat and reserves full-height workspace edges', () => {
  for (const id of ['a', 'b']) {
    const { rect } = panes.find((pane) => pane.id === id)!
    for (const [edge, x, y] of [
      ['top', rect.x + rect.width / 2, 12], ['bottom', rect.x + rect.width / 2, 880],
      ['left', rect.x + 40, 450], ['right', rect.x + rect.width - 40, 450]
    ] as const) assert.deepEqual(browserDropAt(panes, 1600, 900, x, y, null), { target: id, edge })
  }
  assert.deepEqual(browserDropAt(panes, 1600, 900, 15, 450, null), { target: WORKSPACE_DOCK_ID, edge: 'left' })
  assert.deepEqual(browserDropAt(panes, 1600, 900, 1585, 450, null), { target: WORKSPACE_DOCK_ID, edge: 'right' })
  assert.equal(browserDropAt(panes, 1600, 900, 1599, 12, null), null, 'source tab strip is never a workspace target')
})

test('small diagonal movements retain the preview; intentional movement selects the new edge', () => {
  const { rect } = panes[0]!
  const previous = { target: 'a', edge: 'top' } as const
  assert.deepEqual(browserDropAt(panes, 1600, 900, rect.width * 0.24, 225, previous), previous)
  assert.deepEqual(browserDropAt(panes, 1600, 900, rect.width * 0.15, 225, previous), { target: 'a', edge: 'left' })
})

test('self, divider gaps and outside the canvas clear the browser destination', () => {
  const previous = { target: 'a', edge: 'top' } as const
  for (const [x, y] of [[1400, 450], [panes[0]!.rect.width + 2, 450], [-1, 450], [1601, 450], [450, -1], [450, 901]]) {
    assert.equal(browserDropAt(panes, 1600, 900, x!, y!, previous), null)
  }
})

test('preview includes the space reclaimed from the old browser column', () => {
  const preview = browserDropPreview(tree, { target: 'a', edge: 'top' }, 1600, 900)
  assert.deepEqual(preview.panes.find((pane) => pane.id === BROWSER_PANE_ID)!.rect,
    { x: 0, y: 0, width: 793, height: 443 })
  assert.deepEqual(preview.panes.find((pane) => pane.id === 'a')!.rect,
    { x: 0, y: 457, width: 793, height: 443 })
  assert.equal(preview.panes.find((pane) => pane.id === 'b')!.rect.height, 900)
  assert.equal(panes[0]!.rect.width < 793, true, 'hovered tile was smaller than the final browser')
})

test('preview applies minimum sizes in narrow and short workspaces', () => {
  const preview = browserDropPreview(tree, { target: 'a', edge: 'bottom' }, 650, 420)
  const browser = preview.panes.find((pane) => pane.id === BROWSER_PANE_ID)!.rect
  assert.equal(browser.width, 384)
  assert.equal(browser.height, 280)
  assert.equal(browser.y, 294)
  assert.deepEqual(preview.minimum, { width: 698, height: 574 })
})
