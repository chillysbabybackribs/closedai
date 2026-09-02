import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolResourceLocks } from './resource-locks.js'

const navigation = {
  namespace: 'embedded_browser',
  tool: 'page',
  arguments: { action: 'navigate' }
}

test('exclusive surface conflicts fail immediately and release after the call', () => {
  const locks = new ToolResourceLocks()
  const first = locks.tryAcquire(navigation, navigation.arguments, 'pane-a', 'call-a')
  assert.equal(typeof first, 'function')
  const conflict = locks.tryAcquire(navigation, navigation.arguments, 'pane-b', 'call-b')
  assert.equal(typeof conflict, 'string')
  assert.match(String(conflict), /pane-a/)
  if (typeof first === 'function') first()
  const retry = locks.tryAcquire(navigation, navigation.arguments, 'pane-b', 'call-b')
  assert.equal(typeof retry, 'function')
})

test('read-only and unrelated tab operations never acquire a shared lock', () => {
  const locks = new ToolResourceLocks()
  const read = { namespace: 'embedded_browser', tool: 'page', arguments: { action: 'read_page' } }
  assert.equal(typeof locks.tryAcquire(read, read.arguments, 'pane-a', 'read-a'), 'function')
  assert.equal(typeof locks.tryAcquire(read, read.arguments, 'pane-b', 'read-b'), 'function')
  const clickA = { namespace: 'browser_cdp', tool: 'page', arguments: { action: 'click', tab_id: '1' } }
  const clickB = { namespace: 'browser_cdp', tool: 'page', arguments: { action: 'click', tab_id: '2' } }
  assert.equal(typeof locks.tryAcquire(clickA, clickA.arguments, 'pane-a', 'click-a'), 'function')
  assert.equal(typeof locks.tryAcquire(clickB, clickB.arguments, 'pane-b', 'click-b'), 'function')
})
