import assert from 'node:assert/strict'
import test from 'node:test'
import { deskChatIds, sortDeskOpenIds, syncDeskOpenedAt } from './desk-open-order.js'

test('desk chats include windows already open at startup and follow moves and closures', () => {
  const windows = [
    { id: 'main', main: true, cwd: null, focused: true, tabIds: ['stale-local'] },
    { id: 'detached', main: false, cwd: null, focused: false, tabIds: ['c', 'd'] }
  ]
  let seq = 0
  const initial = deskChatIds(['a', 'b'], 'main', windows)
  assert.deepEqual(initial, ['a', 'b', 'c', 'd'])
  const openedAt = syncDeskOpenedAt({}, initial, () => ++seq)
  const moved = deskChatIds(['a', 'b', 'c'], 'main', [{ ...windows[1]!, tabIds: ['d'] }])
  assert.deepEqual(syncDeskOpenedAt(openedAt, moved, () => ++seq), openedAt)
  assert.deepEqual(deskChatIds(['a', 'b'], 'main', []), ['a', 'b'])
  assert.deepEqual(deskChatIds(['c', 'd'], 'detached', [{ ...windows[0]!, tabIds: ['a', 'b'] }, windows[1]!]), ['c', 'd', 'a', 'b'])
})

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
