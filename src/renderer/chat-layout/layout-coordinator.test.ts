import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paneIds } from './layout-tree.ts'
import { coordinatorBrowserSideLayout } from './layout-coordinator.ts'

test('coordinatorBrowserSideLayout stacks chats beside the browser', () => {
  let n = 0
  const tree = coordinatorBrowserSideLayout(
    { groupId: 'g', coordinatorPaneId: 'coord', workerPaneId: 'worker' },
    'home',
    () => `split-${++n}`
  )
  const ids = paneIds(tree)
  assert.deepEqual(ids.sort(), ['coord', 'home', 'worker'])
  assert.equal(tree.kind, 'split')
  if (tree.kind !== 'split') return
  assert.equal(tree.first.kind, 'pane')
  assert.equal(tree.first.id, 'home')
})
