import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserService } from './browser-service.js'
import { BrowserNetworkAccess } from './browser-network-access.js'
import { NetworkLog } from './browser-network/network-log.js'
import type { CdpToolHost } from './tools/cdp/host.js'

test('session network body lookup forwards a captured child session to CDP', async () => {
  const network = new NetworkLog()
  network.begin({ id: 'electron-1', tabId: 'tab-1', url: 'https://a.test/api', method: 'GET', resourceType: 'fetch' })
  const calls: unknown[] = []
  const browser = {
    observers: { network },
    session: { fetch: async () => { throw new Error('Unexpected replay') } }
  } as unknown as BrowserService
  const cdp = {
    networkRequests: async () => ({ requests: [
      { url: 'https://a.test/api', method: 'GET', requestId: 'cdp-1', sessionId: 'worker-1' }
    ] }),
    responseBody: async (...args: unknown[]) => {
      calls.push(args)
      return { text: 'ok', base64Encoded: false, byteLength: 2 }
    }
  } as unknown as CdpToolHost
  const access = new BrowserNetworkAccess(() => browser, () => cdp)
  const result = await access.body('electron-1')
  assert.deepEqual(calls, [['tab-1', 'cdp-1', 'worker-1']])
  assert.equal(result.text, 'ok')
  assert.equal(result.source, 'captured')
  // This tests routing only; URL/method lookup does not establish cross-protocol identity.
})
