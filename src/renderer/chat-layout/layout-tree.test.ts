import assert from 'node:assert/strict'
import test from 'node:test'
import { dockPane, layoutGeometry, paneIds, readLayout, removePane, resizeSplit, saveLayout, type ChatLayout } from './layout-tree.ts'

test('columns remain full height and can split into four quadrants', () => {
  let tree: ChatLayout = { kind: 'pane', id: 'a' }
  tree = dockPane(tree, 'b', 'a', 'right', 'ab')
  let geometry = layoutGeometry(tree, 1005, 805)
  assert.deepEqual(geometry.panes.map((pane) => pane.rect), [
    { x: 0, y: 0, width: 500, height: 805 }, { x: 505, y: 0, width: 500, height: 805 }
  ])
  tree = dockPane(tree, 'c', 'a', 'bottom', 'ac')
  tree = dockPane(tree, 'd', 'b', 'bottom', 'bd')
  geometry = layoutGeometry(tree, 1005, 805)
  assert.equal(geometry.panes.length, 4)
  assert.ok(geometry.panes.every((pane) => pane.rect.width === 500 && pane.rect.height === 400))
})

test('moving a pane collapses its old split without duplication or loss', () => {
  let tree = dockPane({ kind: 'pane', id: 'a' }, 'b', 'a', 'right', 'ab')
  tree = dockPane(tree, 'c', 'a', 'bottom', 'ac')
  tree = dockPane(tree, 'c', 'b', 'top', 'bc')
  assert.deepEqual(paneIds(tree), ['a', 'c', 'b'])
  assert.deepEqual(paneIds(removePane(tree, 'b')), ['a', 'c'])
  assert.deepEqual(dockPane(tree, 'a', 'missing', 'right', 'ignored'), tree)
  assert.deepEqual(dockPane(tree, 'a', 'a', 'right', 'ignored'), tree)
})

test('divider ratios respect readable pane minimums even in a narrow viewport', () => {
  const tree = dockPane({ kind: 'pane', id: 'a' }, 'b', 'a', 'right', 'ab')
  const resized = resizeSplit(tree, 'ab', 0.9)
  const geometry = layoutGeometry(resized, 800, 700)
  assert.equal(geometry.panes[1]!.rect.width, 300)
  const narrow = layoutGeometry(tree, 400, 200)
  assert.ok(narrow.panes.every((pane) => pane.rect.width >= 300 && pane.rect.height >= 280))
})

test('layout persistence is project-scoped and browser visibility is independent', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const tree = dockPane({ kind: 'pane', id: 'a' }, 'b', 'a', 'right', 'ab')
  saveLayout(storage, '/project-a', { tree, browserVisible: false })
  assert.deepEqual(readLayout(storage, '/project-a'), { tree, browserVisible: false })
  assert.deepEqual(readLayout(storage, '/project-b'), { tree: null, browserVisible: true })
  assert.deepEqual(readLayout({ getItem: () => '{bad' }, '/a'), { tree: null, browserVisible: true })
  const duplicate = { kind: 'split', id: 's', ratio: 0.5, axis: 'horizontal', first: { kind: 'pane', id: 'a' }, second: { kind: 'pane', id: 'a' } }
  assert.equal(readLayout({ getItem: () => JSON.stringify({ tree: duplicate, browserVisible: true }) }, '/a').tree, null)
})
