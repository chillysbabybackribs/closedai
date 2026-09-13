import assert from 'node:assert/strict'
import test from 'node:test'
import type { CdpEventRecord } from './cdp-session.js'
import { decodeResponseBody, foldNetworkEvents, mergeRequests, parseResourceTiming } from './cdp-network.js'

function event(method: string, params: unknown, cursor = 1): CdpEventRecord {
  return { cursor, at: 0, method, params, sessionId: null }
}

test('foldNetworkEvents joins a request and its response on the request id', () => {
  const folded = foldNetworkEvents([
    event('Network.requestWillBeSent', { requestId: 'r1', request: { url: 'https://a.test/api', method: 'POST' }, type: 'XHR' }),
    event('Network.responseReceived', { requestId: 'r1', response: { status: 200 }, type: 'XHR' }, 2)
  ])
  assert.deepEqual(folded, [{
    url: 'https://a.test/api', method: 'POST', status: 200, type: 'XHR', requestId: 'r1', sessionId: null, sizeBytes: null, source: 'events'
  }])
})

test('foldNetworkEvents drops events with no request id or url', () => {
  const folded = foldNetworkEvents([
    event('Network.responseReceived', { response: { status: 200 } }),
    event('Network.responseReceived', { requestId: 'r2', response: { status: 204 } })
  ])
  assert.deepEqual(folded, [])
})

test('parseResourceTiming keeps well-formed entries and skips the rest', () => {
  const entries = parseResourceTiming([
    { url: 'https://a.test/app.js', type: 'script', sizeBytes: 100 },
    { url: 'https://a.test/none', type: '', sizeBytes: 'big' },
    { type: 'script' },
    'nope'
  ])
  assert.deepEqual(entries, [
    { url: 'https://a.test/app.js', type: 'script', sizeBytes: 100 },
    { url: 'https://a.test/none', type: null, sizeBytes: null }
  ])
})

test('mergeRequests does not attach URL-level timing facts to an exact captured request', () => {
  const { requests: merged, matched } = mergeRequests(
    [{ url: 'https://a.test/api', method: 'POST', status: 200, type: null, requestId: 'r1', sizeBytes: null, source: 'events' }],
    [
      { url: 'https://a.test/api', type: 'xmlhttprequest', sizeBytes: 512 },
      { url: 'https://a.test/app.js', type: 'script', sizeBytes: 900 }
    ],
    { limit: 10 }
  )
  assert.equal(merged.length, 2)
  assert.equal(matched, 2)
  const api = merged.find((record) => record.url.endsWith('/api'))
  assert.equal(api?.source, 'events')
  assert.equal(api?.type, null)
  assert.equal(api?.sizeBytes, null)
  assert.equal(merged.find((record) => record.url.endsWith('app.js'))?.source, 'timing')
})

test('mergeRequests filters by url and type, and sorts readable bodies first', () => {
  const events = [{ url: 'https://a.test/api/items', method: 'GET', status: 200, type: 'XHR', requestId: 'r1', sizeBytes: null, source: 'events' as const }]
  const timing = [
    { url: 'https://a.test/api/other', type: 'fetch', sizeBytes: 1 },
    { url: 'https://a.test/vendor.js', type: 'script', sizeBytes: 2 }
  ]
  const byUrl = mergeRequests(events, timing, { url: '/api/', limit: 10 }).requests
  assert.deepEqual(byUrl.map((record) => record.url), ['https://a.test/api/items', 'https://a.test/api/other'])
  assert.equal(byUrl[0]?.requestId, 'r1')
  assert.deepEqual(mergeRequests(events, timing, { type: 'script', limit: 10 }).requests.map((r) => r.url), ['https://a.test/vendor.js'])
})

test('mergeRequests honours the limit and still reports what matched', () => {
  const timing = Array.from({ length: 5 }, (_unused, index) => ({ url: `https://a.test/${index}`, type: null, sizeBytes: null }))
  const merged = mergeRequests([], timing, { limit: 2 })
  assert.equal(merged.requests.length, 2)
  assert.equal(merged.matched, 5)
})

test('a URL fetched twice stays "timing": a repeat is not corroboration from events', () => {
  const merged = mergeRequests([], [
    { url: 'https://a.test/api/session', type: 'fetch', sizeBytes: 540 },
    { url: 'https://a.test/api/session', type: 'fetch', sizeBytes: 540 }
  ], { limit: 10 })
  assert.equal(merged.requests.length, 1)
  assert.equal(merged.requests[0]?.source, 'timing')
  assert.equal(merged.requests[0]?.requestId, null)
})

test('decodeResponseBody returns text as-is and decodes base64 text', () => {
  assert.deepEqual(decodeResponseBody('{"a":1}', false), { text: '{"a":1}', base64Encoded: false, byteLength: 7 })
  const encoded = Buffer.from('{"a":1}', 'utf8').toString('base64')
  assert.deepEqual(decodeResponseBody(encoded, true), { text: '{"a":1}', base64Encoded: true, byteLength: 7 })
})

test('decodeResponseBody refuses to dump a binary body', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64')
  const decoded = decodeResponseBody(png, true)
  assert.equal(decoded.text, null)
  assert.equal(decoded.byteLength, 12)
})

test('repeated URLs and overlapping child request ids remain independently readable', () => {
  const url = 'https://a.test/api'
  const events = [
    event('Network.requestWillBeSent', { requestId: 'r1', request: { url, method: 'GET' } }),
    event('Network.requestWillBeSent', { requestId: 'r2', request: { url, method: 'GET' } }),
    { ...event('Network.requestWillBeSent', { requestId: 'r1', request: { url, method: 'POST' } }), sessionId: 'child' },
    event('Network.responseReceived', { requestId: 'r1', response: { status: 200 } }),
    { ...event('Network.responseReceived', { requestId: 'r1', response: { status: 201 } }), sessionId: 'child' }
  ]
  const result = mergeRequests(foldNetworkEvents(events), [{ url, type: 'fetch', sizeBytes: 99 }], { limit: 2 })
  assert.equal(result.matched, 3)
  assert.equal(result.requests.length, 2)
  const all = mergeRequests(foldNetworkEvents(events), [], { limit: 10 }).requests
  assert.deepEqual(all.map(({ requestId, sessionId, status }) => [requestId, sessionId, status]), [
    ['r1', null, 200], ['r2', null, null], ['r1', 'child', 201]
  ])
})

test('a redirect does not carry the prior hop response status into the new request', () => {
  const folded = foldNetworkEvents([
    event('Network.requestWillBeSent', { requestId: 'r1', request: { url: 'https://a.test', method: 'GET' } }),
    event('Network.responseReceived', { requestId: 'r1', response: { status: 302 } }),
    event('Network.requestWillBeSent', { requestId: 'r1', request: { url: 'https://b.test', method: 'GET' } })
  ])
  assert.equal(folded[0].url, 'https://b.test')
  assert.equal(folded[0].status, null)
})

test('text body byte counts measure UTF-8 rather than JavaScript string length', () => {
  assert.equal(decodeResponseBody('é🙂', false).byteLength, 6)
})
