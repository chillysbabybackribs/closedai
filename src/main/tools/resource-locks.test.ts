import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolResourceLocks } from './resource-locks.js'

const navigation = {
  namespace: 'embedded_browser',
  tool: 'page',
  arguments: { action: 'navigate', tab_id: 'tab-1' }
}

test('mutations on the same tab conflict; different tabs run in parallel', () => {
  const locks = new ToolResourceLocks()
  const first = locks.tryAcquire(navigation, navigation.arguments, 'pane-a', 'call-a')
  assert.equal(typeof first, 'function')
  const sameTab = locks.tryAcquire(navigation, navigation.arguments, 'pane-b', 'call-b')
  assert.equal(typeof sameTab, 'string')
  assert.match(String(sameTab), /tab-1/)
  const otherTab = locks.tryAcquire(
    navigation,
    { ...navigation.arguments, tab_id: 'tab-2' },
    'pane-b',
    'call-c'
  )
  assert.equal(typeof otherTab, 'function')
  if (typeof first === 'function') first()
  if (typeof otherTab === 'function') otherTab()
})

test('reads on the same tab do not take a lock', () => {
  const locks = new ToolResourceLocks()
  const read = { namespace: 'embedded_browser', tool: 'page', arguments: { action: 'read_page', tab_id: '1' } }
  assert.equal(typeof locks.tryAcquire(read, read.arguments, 'pane-a', 'read-a'), 'function')
  assert.equal(typeof locks.tryAcquire(read, read.arguments, 'pane-b', 'read-b'), 'function')
})

test('tab-scoped browser_tab reload does not block another tab', () => {
  const locks = new ToolResourceLocks()
  const reload = {
    namespace: 'closedai_app',
    tool: 'command',
    arguments: { action: 'browser_tab', op: 'reload', tab_id: 'tab-1' }
  }
  const read = { namespace: 'embedded_browser', tool: 'page', arguments: { action: 'read_page', tab_id: 'tab-2' } }
  const first = locks.tryAcquire(reload, reload.arguments, 'pane-a', 'reload-a')
  assert.equal(typeof first, 'function')
  assert.equal(typeof locks.tryAcquire(read, read.arguments, 'pane-b', 'read-b'), 'function')
  if (typeof first === 'function') first()
})

test('session mutations share one lane but not tab work', () => {
  const locks = new ToolResourceLocks()
  const cookie = { namespace: 'embedded_browser', tool: 'session', arguments: { action: 'set_cookie', name: 'a' } }
  const read = { namespace: 'embedded_browser', tool: 'page', arguments: { action: 'read_page', tab_id: 'tab-1' } }
  const first = locks.tryAcquire(cookie, cookie.arguments, 'pane-a', 'cookie-a')
  assert.equal(typeof first, 'function')
  assert.equal(typeof locks.tryAcquire(read, read.arguments, 'pane-b', 'read-b'), 'function')
  const second = locks.tryAcquire(cookie, cookie.arguments, 'pane-b', 'cookie-b')
  assert.equal(typeof second, 'string')
  if (typeof first === 'function') first()
})

test('page input shares one foreground lane; reads stay independent', () => {
  const locks = new ToolResourceLocks()
  const click = { namespace: 'browser_cdp', tool: 'page', arguments: { action: 'click', tab_id: '1' } }
  const read = { namespace: 'embedded_browser', tool: 'page', arguments: { action: 'read_page', tab_id: '2' } }
  const first = locks.tryAcquire(click, click.arguments, 'pane-a', 'click-a')
  assert.equal(typeof first, 'function')
  assert.equal(typeof locks.tryAcquire(click, { ...click.arguments, tab_id: '2' }, 'pane-b', 'click-b'), 'string')
  assert.equal(typeof locks.tryAcquire(read, read.arguments, 'pane-b', 'read-b'), 'function')
  if (typeof first === 'function') first()
})
