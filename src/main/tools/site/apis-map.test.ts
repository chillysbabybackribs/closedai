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
  assert.equal(map.endpoints[1]?.resolvedUrl, 'https://app.test/graphql')
  assert.equal(map.endpoints[1]?.sameOrigin, true)
  assert.ok(map.hints.length > 0)
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
