import assert from 'node:assert/strict'
import test from 'node:test'
import { sortDeskOpenIds, syncDeskOpenedAt } from './desk-open-order.js'

test('desk open order keeps newest layout tab first', () => {
  let seq = 0
  const next = () => ++seq
  let openedAt = syncDeskOpenedAt({}, ['a'], next)
  openedAt = syncDeskOpenedAt(openedAt, ['a', 'b'], next)
  assert.deepEqual(sortDeskOpenIds(['a', 'b'], openedAt), ['b', 'a'])
  assert.deepEqual(sortDeskOpenIds(['b', 'a'], openedAt), ['b', 'a'])
})

test('closing a desk chat drops it from open order state', () => {
  let seq = 0
  let openedAt = syncDeskOpenedAt({}, ['a', 'b'], () => ++seq)
  openedAt = syncDeskOpenedAt(openedAt, ['a'], () => ++seq)
  assert.deepEqual(sortDeskOpenIds(['a'], openedAt), ['a'])
  assert.equal(openedAt.b, undefined)
})
