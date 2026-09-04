import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { ConsoleLog } from './console-log.js'

function tab(log: ConsoleLog, id: string): EventEmitter {
  const contents = new EventEmitter()
  log.attach(id, contents as unknown as Parameters<ConsoleLog['attach']>[1])
  return contents
}

test('captures console messages per tab with level, source, and line, ignoring app sentinels', () => {
  const log = new ConsoleLog((message) => message.startsWith('__app:'))
  const first = tab(log, 'tab-1')
  const second = tab(log, 'tab-2')
  first.emit('console-message', { level: 'error', message: 'Uncaught TypeError: x', lineNumber: 12, sourceId: 'https://a.test/app.js', frame: { url: 'https://a.test/' } })
  first.emit('console-message', { level: 'debug', message: '__app:zoom' })
  second.emit('console-message', { level: 1, message: 'hello' })
  const listing = log.list({ tabId: 'tab-1', limit: 10 })
  assert.equal(listing.matched, 1)
  assert.equal(listing.entries[0].level, 'error')
  assert.equal(listing.entries[0].line, 12)
  assert.equal(listing.entries[0].source, 'https://a.test/app.js')
  assert.equal(log.list({ tabId: 'tab-2', limit: 10 }).entries[0].level, 'info')
})

test('navigation markers bound since_navigation and min_level filters messages', () => {
  const log = new ConsoleLog()
  const contents = tab(log, 'tab-1')
  contents.emit('console-message', { level: 'error', message: 'old error' })
  contents.emit('did-navigate', {}, 'https://a.test/next')
  contents.emit('console-message', { level: 'warning', message: 'new warning' })
  contents.emit('console-message', { level: 'info', message: 'new info' })
  const recent = log.list({ tabId: 'tab-1', sinceNavigation: true, limit: 10 })
  assert.deepEqual(recent.entries.map((entry) => entry.message), ['navigated to https://a.test/next', 'new warning', 'new info'])
  assert.equal(typeof recent.lastNavigationAt, 'number')
  const warnings = log.list({ tabId: 'tab-1', minLevel: 'warning', limit: 10 })
  assert.deepEqual(warnings.entries.map((entry) => entry.message), ['old error', 'navigated to https://a.test/next', 'new warning'])
  assert.deepEqual(log.list({ tabId: 'tab-1', contains: 'WARN', limit: 10 }).entries.map((entry) => entry.message), ['new warning'])
})

test('cursors read incrementally and capacity evicts the oldest', () => {
  const log = new ConsoleLog(() => false, 3)
  const contents = tab(log, 'tab-1')
  for (const message of ['a', 'b', 'c', 'd']) contents.emit('console-message', { level: 'info', message })
  const all = log.list({ tabId: 'tab-1', limit: 10 })
  assert.deepEqual(all.entries.map((entry) => entry.message), ['b', 'c', 'd'])
  const page = log.list({ tabId: 'tab-1', afterCursor: 2, limit: 1 })
  assert.deepEqual(page.entries.map((entry) => entry.message), ['c'])
  assert.deepEqual(log.list({ tabId: 'tab-1', afterCursor: page.nextCursor, limit: 10 }).entries.map((entry) => entry.message), ['d'])
  assert.equal(log.clear('tab-1'), 3)
})
