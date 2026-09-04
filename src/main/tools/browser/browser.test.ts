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

test('browser tool advertises one tool with three actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['embedded_browser.page'])
  assert.deepEqual(registry.namespaces[0].tools[0].actions?.map((action) => action.name), ['navigate', 'read_page', 'wait_for'])
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
