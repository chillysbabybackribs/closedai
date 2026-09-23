import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BROWSER_PANE_ID, paneIds } from './layout-tree.ts'
import { coordinatorBrowserSideLayout } from './layout-coordinator.ts'

test('coordinatorBrowserSideLayout stacks chats beside the browser', () => {
  let n = 0
  const tree = coordinatorBrowserSideLayout(
    { groupId: 'g', coordinatorPaneId: 'coord', workerPaneId: 'worker' },
    () => `split-${++n}`
  )
  const ids = paneIds(tree)
  assert.deepEqual(ids.sort(), ['coord', 'worker'])
  assert.equal(tree.kind, 'split')
  if (tree.kind !== 'split') return
  assert.equal(tree.second.kind, 'pane')
  assert.equal(tree.second.id, BROWSER_PANE_ID)
})
