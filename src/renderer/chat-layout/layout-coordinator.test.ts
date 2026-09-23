import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coordinatorWorkspaceLayout } from './layout-coordinator.ts'
import { paneIds } from './layout-tree.ts'

test('coordinatorWorkspaceLayout places coordinator beside stacked workers', () => {
  const tree = coordinatorWorkspaceLayout(
    { groupId: 'g', coordinatorPaneId: 'coord', workerPaneIds: ['wa', 'wb'] },
    () => crypto.randomUUID()
  )
  assert.deepEqual(new Set(paneIds(tree)), new Set(['coord', 'wa', 'wb']))
})
