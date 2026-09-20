import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserService } from './browser-service.js'
import { BrowserNetworkAccess } from './browser-network-access.js'
import { NetworkLog } from './browser-network/network-log.js'

test('explicit replay uses only the selected record and labels a new response', async () => {
  const network = new NetworkLog()
  for (const id of ['one', 'two']) network.begin({
    id, tabId: 'tab-1', url: 'https://a.test/api', method: 'POST', resourceType: 'fetch',
    postData: { text: id, byteLength: id.length, truncated: false }
  })
  const calls: unknown[] = []
  const browser = {
    observers: { network },
    session: { fetch: async (...args: unknown[]) => { calls.push(args); return new Response('new response', { status: 201 }) } }
  } as unknown as BrowserService
  const access = new BrowserNetworkAccess(() => browser)
  access.requests({ limit: 20 })
  assert.deepEqual(calls, [])
  const result = await access.replay('two')
  assert.deepEqual(calls, [['https://a.test/api', { method: 'POST', headers: {}, credentials: 'include', redirect: 'follow', body: 'two' }]])
  assert.equal(result.text, 'new response')
  assert.equal(result.status, 201)
  assert.equal(result.source, 'replay')
  assert.match(result.note!, /not the historical response/)
})

test('replay rejects missing and incomplete records without sending requests', async () => {
  const network = new NetworkLog()
  const browser = { observers: { network }, session: { fetch: async () => assert.fail('Unexpected request') } } as unknown as BrowserService
  const access = new BrowserNetworkAccess(() => browser)
  await assert.rejects(access.replay('missing'), /No recorded request/)
  for (const postData of [{ text: null, byteLength: 10, truncated: false }, { text: 'partial', byteLength: 50, truncated: true }]) {
    network.begin({ id: 'bad', tabId: null, url: 'https://a.test/api', method: 'POST', resourceType: 'fetch', postData })
    await assert.rejects(access.replay('bad'), /cannot be replayed/)
  }
})
