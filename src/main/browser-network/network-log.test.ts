import assert from 'node:assert/strict'
import test from 'node:test'
import { flattenHeaders, NetworkLog } from './network-log.js'

function clock(): { now: () => number; tick: (ms: number) => void } {
  let at = 1_000
  return { now: () => at, tick: (ms) => { at += ms } }
}

function seed(log: NetworkLog, id: string, url: string, tabId: string | null = 'tab-1', method = 'GET'): void {
  log.begin({ id, tabId, url, method, resourceType: 'xhr' })
}

test('records a request through its lifecycle with headers, status, timing, and mime type', () => {
  const time = clock()
  const log = new NetworkLog(100, time.now)
  seed(log, '1', 'https://api.test/items')
  log.requestHeaders('1', { Accept: 'application/json', Cookie: 'a=b' })
  time.tick(40)
  log.responseHeaders('1', { status: 200, statusLine: 'HTTP/1.1 200 OK', headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  time.tick(10)
  log.complete('1', { status: 200, fromCache: false })
  const listing = log.list({ limit: 10, includeHeaders: true })
  const record = listing.requests[0]
  assert.equal(listing.matched, 1)
  assert.equal(record.state, 'completed')
  assert.equal(record.status, 200)
  assert.equal(record.mimeType, 'application/json')
  assert.equal(record.durationMs, 50)
  assert.deepEqual('requestHeaders' in record ? record.requestHeaders : null, { accept: 'application/json', cookie: 'a=b' })
})

test('summaries omit headers and post data but say whether a body was posted', () => {
  const log = new NetworkLog()
  log.begin({ id: '1', tabId: 'tab-1', url: 'https://api.test/save', method: 'POST', resourceType: 'fetch', postData: { text: '{"a":1}', byteLength: 7, truncated: false } })
  const summary = log.list({ limit: 10 }).requests[0]
  assert.equal('requestHeaders' in summary, false)
  assert.equal('hasPostData' in summary && summary.hasPostData, true)
})

test('filters by tab, url, type, method, status, and state and reports matched before the limit', () => {
  const log = new NetworkLog()
  seed(log, '1', 'https://a.test/api/one')
  seed(log, '2', 'https://a.test/api/two', 'tab-2')
  seed(log, '3', 'https://a.test/img.png', 'tab-1')
  seed(log, '4', 'https://a.test/api/three', 'tab-1', 'POST')
  log.complete('1', { status: 200, fromCache: false })
  log.fail('2', 'net::ERR_FAILED')
  assert.equal(log.list({ tabId: 'tab-1', limit: 10 }).matched, 3)
  assert.equal(log.list({ url: '/API/', limit: 10 }).matched, 3)
  assert.equal(log.list({ method: 'post', limit: 10 }).matched, 1)
  assert.equal(log.list({ status: 200, limit: 10 }).matched, 1)
  assert.equal(log.list({ state: 'failed', limit: 10 }).requests[0].error, 'net::ERR_FAILED')
  const limited = log.list({ limit: 2 })
  assert.equal(limited.matched, 4)
  assert.deepEqual(limited.requests.map((record) => record.id), ['3', '4'])
})

test('after_cursor reads incrementally and nextCursor continues the walk', () => {
  const log = new NetworkLog()
  seed(log, '1', 'https://a.test/1')
  seed(log, '2', 'https://a.test/2')
  const first = log.list({ afterCursor: 0, limit: 1 })
  assert.deepEqual(first.requests.map((record) => record.id), ['1'])
  const second = log.list({ afterCursor: first.nextCursor, limit: 10 })
  assert.deepEqual(second.requests.map((record) => record.id), ['2'])
  assert.equal(log.list({ afterCursor: second.nextCursor, limit: 10 }).returned, 0)
})

test('evicts the oldest records past capacity and clears per tab', () => {
  const log = new NetworkLog(2)
  seed(log, '1', 'https://a.test/1')
  seed(log, '2', 'https://a.test/2', 'tab-2')
  seed(log, '3', 'https://a.test/3')
  assert.equal(log.get('1'), null)
  assert.equal(log.list({ limit: 10 }).oldestCursor, 2)
  assert.equal(log.clear('tab-2'), 1)
  assert.deepEqual(log.list({ limit: 10 }).requests.map((record) => record.id), ['3'])
})

test('waitFor resolves on a later matching completion and ignores earlier traffic', async () => {
  const log = new NetworkLog()
  seed(log, '1', 'https://a.test/api/search')
  log.complete('1', { status: 200, fromCache: false })
  const cursor = log.list({ limit: 1 }).nextCursor
  const pending = log.waitFor({ url: '/api/search', afterCursor: cursor, timeoutMs: 500 })
  seed(log, '2', 'https://a.test/api/other')
  log.complete('2', { status: 200, fromCache: false })
  seed(log, '3', 'https://a.test/api/search?q=x', 'tab-1', 'POST')
  log.complete('3', { status: 201, fromCache: false })
  const result = await pending
  assert.equal(result.matched, true)
  assert.equal(result.matched && result.request.id, '3')
})

test('waitFor answers immediately from a finished match and times out cleanly', async () => {
  const log = new NetworkLog()
  seed(log, '1', 'https://a.test/api/x')
  log.complete('1', { status: 204, fromCache: true })
  const already = await log.waitFor({ url: '/api/x', afterCursor: 0, timeoutMs: 100 })
  assert.equal(already.matched, true)
  const missed = await log.waitFor({ url: '/never', afterCursor: 0, timeoutMs: 20 })
  assert.deepEqual({ matched: missed.matched, timedOut: !missed.matched && missed.timedOut }, { matched: false, timedOut: true })
})

test('blocked and redirected requests carry the rule that decided them', () => {
  const log = new NetworkLog()
  seed(log, '1', 'https://tracker.test/px')
  log.blocked('1', 'rule-1')
  seed(log, '2', 'https://a.test/old')
  log.blocked('2', 'rule-2', 'https://a.test/new')
  assert.equal(log.get('1')?.state, 'blocked')
  assert.equal(log.get('1')?.ruleId, 'rule-1')
  assert.equal(log.get('2')?.state, 'pending')
  assert.deepEqual(log.get('2')?.redirects, ['https://a.test/new'])
})

test('a blocked request keeps its state when Chromium also reports it as an error', () => {
  // Cancelling at onBeforeRequest always produces a following ERR_BLOCKED_BY_CLIENT.
  const log = new NetworkLog()
  seed(log, '1', 'https://tracker.test/px')
  log.blocked('1', 'rule-1')
  log.fail('1', 'net::ERR_BLOCKED_BY_CLIENT')
  const record = log.get('1')
  assert.equal(record?.state, 'blocked')
  assert.equal(record?.ruleId, 'rule-1')
  assert.equal(record?.error, 'net::ERR_BLOCKED_BY_CLIENT')
  assert.equal(log.list({ state: 'blocked', limit: 10 }).matched, 1)
})

test('flattenHeaders joins repeated response headers', () => {
  assert.deepEqual(flattenHeaders({ 'Set-Cookie': ['a=1', 'b=2'], Server: 'x' }), { 'Set-Cookie': 'a=1, b=2', Server: 'x' })
})
