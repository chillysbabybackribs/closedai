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

test('different tabs allow parallel reads but foreground input shares a lock', () => {
  const locks = new ToolResourceLocks()
  const read = { namespace: 'embedded_browser', tool: 'page', arguments: { action: 'read_page', tab_id: '1' } }
  const first = locks.tryAcquire(read, read.arguments, 'pane-a', 'read-a')
  const second = locks.tryAcquire(read, { ...read.arguments, tab_id: '2' }, 'pane-b', 'read-b')
  assert.equal(typeof first, 'function')
  assert.equal(typeof second, 'function')
  assert.equal(typeof locks.tryAcquire(read, read.arguments, 'pane-b', 'same-tab'), 'string')
  if (typeof first === 'function') first()
  if (typeof second === 'function') second()
  const clickA = { namespace: 'browser_cdp', tool: 'page', arguments: { action: 'click', tab_id: '1' } }
  const clickB = { namespace: 'browser_cdp', tool: 'page', arguments: { action: 'click', tab_id: '2' } }
  assert.equal(typeof locks.tryAcquire(clickA, clickA.arguments, 'pane-a', 'click-a'), 'function')
  assert.equal(typeof locks.tryAcquire(clickB, clickB.arguments, 'pane-b', 'click-b'), 'string')
})

test('call ids from different provider panes cannot bypass a held lock', () => {
  const locks = new ToolResourceLocks()
  assert.equal(typeof locks.tryAcquire(navigation, navigation.arguments, 'pane-a', 'same-id'), 'function')
  assert.equal(typeof locks.tryAcquire(navigation, navigation.arguments, 'pane-b', 'same-id'), 'string')
})

test('raw CDP commands lock their explicit tab and conflict with active-tab work', () => {
  const locks = new ToolResourceLocks()
  const raw = {
    namespace: 'browser_cdp', tool: 'protocol',
    arguments: { action: 'command', tab_id: 'tab-1', method: 'Runtime.evaluate' }
  }
  const active = {
    namespace: 'browser_cdp', tool: 'protocol',
    arguments: { action: 'command', method: 'Runtime.evaluate' }
  }
  const first = locks.tryAcquire(raw, raw.arguments, 'pane-a', 'raw-a')
  assert.equal(typeof first, 'function')
  assert.match(String(locks.tryAcquire(raw, raw.arguments, 'pane-b', 'raw-b')), /browser tab tab-1/)
  assert.match(String(locks.tryAcquire(active, active.arguments, 'pane-b', 'active-b')), /active browser or tab strip/)
  if (typeof first === 'function') first()
  const activeLock = locks.tryAcquire(active, active.arguments, 'pane-b', 'active-b')
  assert.equal(typeof activeLock, 'function')
  assert.match(String(locks.tryAcquire(raw, raw.arguments, 'pane-a', 'raw-a')), /browser tab tab-1/)
})
