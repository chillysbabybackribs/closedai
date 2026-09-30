import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApiMap, parseInstrumentHttpDetail } from './apis-map.js'

test('parseInstrumentHttpDetail reads method and url', () => {
  assert.deepEqual(parseInstrumentHttpDetail('GET https://api.test/v1/items'), {
    method: 'GET',
    url: 'https://api.test/v1/items'
  })
})

test('buildApiMap aggregates fetch and xhr with relative resolution', () => {
  const map = buildApiMap(
    {
      installed: true,
      url: 'https://app.test/dashboard',
      counts: { fetch: 2, xhr: 1 },
      dropped: 0,
      distinct: [
        { channel: 'fetch', detail: 'GET https://api.test/v1/me', count: 3 },
        { channel: 'xhr', detail: 'POST /graphql', count: 1 }
      ],
      recent: [{ channel: 'fetch', detail: 'GET https://api.test/v1/me', atMs: 1200 }]
    },
    { pageOrigin: 'https://app.test', limit: 10 }
  )
  assert.equal(map.installed, true)
  assert.equal(map.endpoints.length, 2)
  assert.equal(map.endpoints[0]?.method, 'GET')
  assert.equal(map.endpoints[0]?.resolvedUrl, 'https://api.test/v1/me')
  assert.equal(map.endpoints[0]?.count, 3)
  assert.equal(map.endpoints[0]?.lastAtMs, 1200)
  assert.equal(map.endpoints[1]?.resolvedUrl, 'https://app.test/graphql')
  assert.equal(map.endpoints[1]?.sameOrigin, true)
  assert.ok(map.hints.length > 0)
})

test('recent-only endpoints count once per event and frame counts add without double counting', () => {
  const detail = 'GET /items'
  const map = buildApiMap({
    installed: true, url: 'https://app.test/', counts: { fetch: 3 }, dropped: 2,
    distinct: [{ channel: 'fetch', detail, count: 3 }],
    recent: [{ channel: 'fetch', detail, atMs: 10 }],
    frames: [{ installed: true, url: 'https://app.test/frame', counts: { fetch: 2 }, dropped: 0,
      distinct: [], recent: [{ channel: 'fetch', detail, atMs: 12 }, { channel: 'fetch', detail, atMs: 14 }] }]
  }, { limit: 10 })
  assert.equal(map.endpoints[0]?.count, 5)
  assert.equal(map.endpoints[0]?.lastAtMs, 14)
  assert.equal(map.channelCounts.fetch, 5)
  assert.equal(map.dropped, 2)
})

test('capped recorder labels cannot masquerade as complete fetch URLs', () => {
  const map = buildApiMap({
    installed: true, url: 'https://app.test/', counts: { xhr: 1 }, dropped: 0,
    distinct: [{ channel: 'xhr', detail: ('GET https://app.test/?q=' + 'x'.repeat(220)).slice(0, 200), count: 1 }], recent: []
  }, { limit: 10 })
  assert.equal(map.endpoints[0]?.urlMayBeTruncated, true)
  assert.match(map.hints[0]!, /clipped label.*full URL/)
})

test('buildApiMap reports missing recorder', () => {
  const map = buildApiMap({ installed: false, counts: {}, dropped: 0, distinct: [], recent: [] }, { limit: 5 })
  assert.equal(map.installed, false)
  assert.match(map.message ?? '', /hook before navigate/i)
})

test('buildApiMap origin_only filters cross-origin', () => {
  const map = buildApiMap(
    {
      installed: true,
      url: 'https://app.test/',
      counts: { fetch: 2 },
      dropped: 0,
      distinct: [
        { channel: 'fetch', detail: 'GET https://other.test/data', count: 1 },
        { channel: 'fetch', detail: 'GET https://app.test/data', count: 1 }
      ],
      recent: []
    },
    { pageOrigin: 'https://app.test', originOnly: true, limit: 10 }
  )
  assert.equal(map.endpoints.length, 1)
  assert.equal(map.endpoints[0]?.sameOrigin, true)
})
