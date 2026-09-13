import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import type { BrowserToolHost } from './host.js'
import { browserTools } from './index.js'
import type { NetworkToolHost } from './network-host.js'

const page = {} as BrowserToolHost

function harness() {
  const calls: unknown[] = []
  const host: NetworkToolHost = {
    requests: (filter) => (calls.push(['requests', filter]), { matched: 1, returned: 1, oldestCursor: 1, nextCursor: 7, requests: [] }),
    waitFor: async (wait) => (calls.push(['wait', wait]), { matched: false, elapsedMs: wait.timeoutMs, timedOut: true }),
    body: async (id) => (calls.push(['body', id]), { id, url: 'https://a.test/api', method: 'GET', status: 200, source: 'replay', contentType: 'application/json', text: '{}', base64: null, byteLength: 2, truncated: false }),
    rules: () => [],
    addRule: (input) => (calls.push(['addRule', input]), { id: 'rule-1', action: input.action, urlPattern: input.urlPattern, tabId: input.tabId ?? null, redirectUrl: input.redirectUrl ?? null, headers: input.headers ?? null, note: input.note ?? null, hits: 0 }),
    removeRule: (id) => id === 'rule-1',
    clear: (tabId) => (calls.push(['clear', tabId]), 3)
  }
  const registry = new ToolRegistry([browserTools(() => page, () => host)])
  const call = (args: Record<string, unknown>) =>
    registry.call({ namespace: 'embedded_browser', tool: 'network', arguments: args }, { threadId: null, turnId: null, callId: 'c' })
  return { calls, call, registry }
}

function payload(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text ?? '{}' : '{}') as Record<string, unknown>
}

test('the network tool registers beside page with its seven actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['embedded_browser.page', 'embedded_browser.script', 'embedded_browser.network'])
  assert.deepEqual(registry.namespaces[0].tools[2].actions?.map((action) => action.name), [
    'requests', 'wait', 'body', 'rules', 'add_rule', 'remove_rule', 'clear'
  ])
})

test('requests maps every filter and defaults the limit', async () => {
  const { calls, call } = harness()
  await call({ action: 'requests', tab_id: 'tab-1', url_contains: '/api', resource_type: 'xhr', method: 'POST', status: 201, state: 'completed', after_cursor: 4, include_headers: true })
  assert.deepEqual(calls[0], ['requests', { tabId: 'tab-1', url: '/api', type: 'xhr', method: 'POST', status: 201, state: 'completed', afterCursor: 4, includeHeaders: true, limit: 40 }])
  await call({ action: 'requests' })
  assert.deepEqual(calls[1], ['requests', { tabId: undefined, url: undefined, type: undefined, method: undefined, status: undefined, state: undefined, afterCursor: undefined, includeHeaders: false, limit: 40 }])
})

test('wait requires url_contains, passes the cursor, and returns a timeout as data', async () => {
  const { calls, call } = harness()
  const result = await call({ action: 'wait', url_contains: '/search', after_cursor: 9, timeout_ms: 250 })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], ['wait', { tabId: undefined, url: '/search', method: undefined, afterCursor: 9, timeoutMs: 250 }])
  assert.deepEqual(payload(result), { matched: false, elapsedMs: 250, timedOut: true })
  const missing = await call({ action: 'wait' })
  assert.equal(missing.isError, true)
})

test('body, rules, and clear route to the host', async () => {
  const { calls, call } = harness()
  assert.equal(payload(await call({ action: 'body', request_id: '12' })).source, 'replay')
  const added = await call({ action: 'add_rule', rule_action: 'request_headers', url_pattern: 'api.test', headers: { Authorization: 'Bearer t', 'X-Old': null }, note: 'auth' })
  assert.equal(added.isError, undefined)
  assert.deepEqual(calls[1], ['addRule', { action: 'request_headers', urlPattern: 'api.test', tabId: null, redirectUrl: null, headers: { Authorization: 'Bearer t', 'X-Old': null }, note: 'auth' }])
  const badHeaders = await call({ action: 'add_rule', rule_action: 'request_headers', url_pattern: 'a', headers: { a: 1 } })
  assert.equal(badHeaders.isError, true)
  assert.equal((await call({ action: 'remove_rule', rule_id: 'rule-1' })).isError, undefined)
  assert.equal((await call({ action: 'remove_rule', rule_id: 'rule-9' })).isError, true)
  assert.deepEqual(payload(await call({ action: 'clear', tab_id: 'tab-2' })), { cleared: 3 })
})
