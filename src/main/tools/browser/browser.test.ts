import assert from 'node:assert/strict'
import test from 'node:test'
import type { PageReadyResult } from '../../browser-page-ready.js'
import { ToolRegistry } from '../registry.js'
import type { BrowserToolHost } from './host.js'
import { browserTools } from './index.js'

const ready: PageReadyResult = { readyState: 'complete', reached: true, conditionMet: null, elapsedMs: 800, url: 'https://a.test/', title: 'A' }

function harness(overrides: Partial<BrowserToolHost> = {}) {
  const calls: unknown[] = []
  const host: BrowserToolHost = {
    listTabs: () => [],
    readPage: async (tabId, options) => {
      calls.push(['readPage', tabId, options])
      return tabId === 'missing' ? null : { url: 'https://a.test/', title: 'A', readyState: 'complete', text: 'Hello world', truncated: false }
    },
    fetchPage: async (tabId, request) => {
      calls.push(['fetchPage', tabId, request])
      return tabId === 'missing' ? null : {
        url: 'https://a.test/data',
        status: 200,
        ok: true,
        contentType: 'text/plain',
        text: 'Hello world',
        bodyLength: 11,
        truncated: false
      }
    },
    navigate: async (url, options) => {
      calls.push(['navigate', url, options])
      return { ok: true, tabId: 'tab-1', ready }
    },
    waitFor: async (tabId, readiness) => {
      calls.push(['waitFor', tabId, readiness])
      return { ...ready, reached: false, readyState: 'interactive', elapsedMs: readiness.timeoutMs }
    },
    ...overrides
  }
  const registry = new ToolRegistry([browserTools(() => host)])
  const call = (args: Record<string, unknown>) =>
    registry.call({ namespace: 'embedded_browser', tool: 'page', arguments: args }, { threadId: null, turnId: null, callId: 'c' })
  return { calls, call, registry }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('browser tool advertises one tool with browser page actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['embedded_browser.page'])
  assert.deepEqual(registry.namespaces[0].tools[0].actions?.map((action) => action.name), [
    'navigate', 'read_page', 'wait_for', 'fetch', 'extract'
  ])
})

test('navigate defaults to dom-ready readiness and reports the reached state', async () => {
  const { calls, call } = harness()
  const result = await call({ action: 'navigate', url: 'a.test' })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], ['navigate', 'a.test', { newTab: false, ready: { until: 'dom_ready', selector: undefined, text: undefined, timeoutMs: 3_000 } }])
  assert.match(textOf(result), /Loaded: A\nURL: https:\/\/a.test\/\nTab: tab-1\nReady: complete after 0.8s/)
})

test('navigate passes selector, text, timeout, and new_tab through and surfaces failures', async () => {
  const seen: unknown[] = []
  const { call } = harness({ navigate: async (url, options) => { seen.push([url, options]); return { ok: false, error: 'ERR_NAME_NOT_RESOLVED' } } })
  const result = await call({ action: 'navigate', url: 'x', new_tab: true, wait_until: 'load', wait_for_selector: '#r', timeout_ms: 2_000 })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /Navigation to x failed: ERR_NAME_NOT_RESOLVED/)
  assert.deepEqual(seen[0], ['x', { newTab: true, ready: { until: 'load', selector: '#r', text: undefined, timeoutMs: 2_000 } }])
})

test('read_page returns header, load state, and text; missing tabs fail', async () => {
  const { call } = harness()
  const ok = await call({ action: 'read_page' })
  assert.equal(textOf(ok), 'Title: A\nURL: https://a.test/\nLoad state: complete\n\nHello world')
  const missing = await call({ action: 'read_page', tab_id: 'missing' })
  assert.equal(missing.isError, true)
})

test('wait_for reports an unmet wait as a failure the model can act on', async () => {
  const { call } = harness()
  const result = await call({ action: 'wait_for', wait_until: 'load', timeout_ms: 1_000 })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /Not ready: still "dom-ready" when the 1s wait ended/)
})

const apiBody = JSON.stringify({ data: { items: [{ name: 'One', mrr: 1 }, { name: 'Two', mrr: 2 }] } })

function jsonHarness(seen: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return harness({
    fetchPage: async (tabId, request) => (seen.push([tabId, request]), {
      url: 'https://a.test/api',
      status: 200,
      ok: true,
      contentType: 'application/json',
      text: apiBody,
      bodyLength: apiBody.length,
      truncated: false,
      ...overrides
    } as Awaited<ReturnType<BrowserToolHost['fetchPage']>>)
  })
}

test('fetch calls from inside the tab and parses a JSON response', async () => {
  const seen: unknown[] = []
  const { call } = jsonHarness(seen)
  const result = await call({
    action: 'fetch', url: '/api', method: 'POST', body: '{"page":1}', headers: { 'content-type': 'application/json' }
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(seen[0], [undefined, {
    url: '/api', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"page":1}'
  }])
  const payload = JSON.parse(textOf(result)) as { status: number; json: { data: { items: unknown[] } } }
  assert.equal(payload.status, 200)
  assert.equal(payload.json.data.items.length, 2)
})

test('fetch reports a missing tab rather than pretending the request ran', async () => {
  const { call } = harness()
  const result = await call({ action: 'fetch', url: '/api', tab_id: 'missing' })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /No tab with id missing/)
})

test('extract returns only the projected fields and reports what it dropped', async () => {
  const { call } = jsonHarness()
  const result = await call({ action: 'extract', url: '/api', path: 'data.items', fields: ['name'], limit: 1 })
  const payload = JSON.parse(textOf(result)) as { matched: number; returned: number; limited: boolean; value: unknown }
  assert.deepEqual(payload.value, [{ name: 'One' }])
  assert.equal(payload.matched, 2)
  assert.equal(payload.returned, 1)
  assert.equal(payload.limited, true)
})

test('extract fails with advice when the path or the content is wrong', async () => {
  const { call } = jsonHarness()
  const noPath = await call({ action: 'extract', url: '/api', path: 'data.missing' })
  assert.equal(noPath.isError, true)
  assert.match(textOf(noPath), /No value at path "data.missing"/)

  // The default harness page is prose, not JSON: extract should say so instead of half-parsing it.
  const notJson = await call({ action: 'extract' })
  assert.equal(notJson.isError, true)
  assert.match(textOf(notJson), /is not a JSON document/)
})

test('invalid arguments are rejected per action', async () => {
  const { call } = harness()
  // The registry checks the advertised union schema first (enum), then the action's own schema.
  const badEnum = await call({ action: 'navigate', wait_until: 'never' })
  assert.equal(badEnum.isError, true)
  assert.match(textOf(badEnum), /page: invalid arguments — \$\.wait_until must be one of/)
  const missing = await call({ action: 'navigate' })
  assert.equal(missing.isError, true)
  assert.match(textOf(missing), /page\.navigate: invalid arguments — \$\.url is required/)
})
