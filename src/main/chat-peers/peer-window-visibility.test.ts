import assert from 'node:assert/strict'
import test from 'node:test'
import { PeerWindowVisibility } from './peer-window-visibility.js'

test('each window replaces only its own report and the workspace sees the union', () => {
  const visibility = new PeerWindowVisibility()
  visibility.set('main', ['a'], ['a', 'b'])
  visibility.set('w1', ['c'], ['c'])
  visibility.set('main', ['b'], ['a', 'b'])
  assert.deepEqual([...visibility.visible()].sort(), ['b', 'c'])
  assert.deepEqual([...visibility.retained()].sort(), ['a', 'b', 'c'])
  assert.equal(visibility.release('w1'), true)
  assert.equal(visibility.release('w1'), false)
  assert.deepEqual([...visibility.visible()], ['b'])
})
