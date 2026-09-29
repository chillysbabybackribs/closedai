import assert from 'node:assert/strict'
import test from 'node:test'
import { absorbCrossWindowDock, dockIncomingPane } from './cross-window-absorb.ts'

test('dockIncomingPane stacks a new chat below the target tile', () => {
  const tree = { kind: 'pane' as const, id: 'a', tabs: ['a', 'view'] }
  const next = dockIncomingPane(tree, 'b', ['b'], 'a', 'bottom', 's1')
  assert.equal(next.kind, 'split')
  if (next.kind !== 'split') return
  assert.equal(next.axis, 'vertical')
  assert.deepEqual(next.first, tree)
  assert.deepEqual(next.second, { kind: 'pane', id: 'b', tabs: ['b'] })
})

test('absorbCrossWindowDock joins tabs on the target strip', () => {
  const tree = { kind: 'pane' as const, id: 'a', tabs: ['a'] }
  const next = absorbCrossWindowDock(tree, 'b', ['b'], { kind: 'group', target: 'a' }, 's1')
  assert.deepEqual(next.kind === 'pane' ? next.tabs : null, ['a', 'b'])
})
