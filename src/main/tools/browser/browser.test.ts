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
    listTabs: () => [{ id: 'tab-1', pos: 1, title: 'A', url: 'https://a.test/', favicon: null, isLoading: false, active: true }],
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
    evaluate: async (tabId, request) => {
      calls.push(['evaluate', tabId, request])
      return tabId === 'missing' ? null : { ok: true, type: 'object', value: { title: 'A' }, truncated: false }
    },
    query: async (tabId, request) => {
      calls.push(['query', tabId, request])
      return tabId === 'missing' ? null : { selector: request.selector, matched: 1, returned: 1, items: [] }
    },
    consoleMessages: (tabId, filter) => {
      calls.push(['console', tabId, filter])
      return tabId === 'missing' ? null : { matched: 0, returned: 0, nextCursor: 0, lastNavigationAt: null, entries: [] }
    },
    ...overrides
  }
  const registry = new ToolRegistry([browserTools(() => host)])
  const call = (args: Record<string, unknown>) =>
    registry.call({ namespace: 'embedded_browser', tool: 'page', arguments: args }, { threadId: null, turnId: null, callId: 'c' })
  const scriptCall = (args: Record<string, unknown>) =>
    registry.call({ namespace: 'embedded_browser', tool: 'script', arguments: args }, { threadId: null, turnId: null, callId: 'c' })
  return { calls, call, scriptCall, registry }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('read_page passes PDF page selection and reports native provenance and limits', async () => {
  let selected: unknown
  const { call } = harness({ readPage: async (_tab, options) => {
    selected = options
    return { url: 'https://a.test/paper.pdf', title: 'Paper', readyState: 'complete', text: 'PDF paragraph', truncated: false,
      pdf: { page: 2, totalPages: 17, pagesAvailable: 3, available: true } }
  } })
  const result = await call({ action: 'read_page', pdf_page: 2 })
  assert.equal((selected as { pdfPage: number }).pdfPage, 2)
  assert.match(textOf(result), /PDF page: 2 of 17/)
  assert.match(textOf(result), /Chromium native PDF accessibility/)
  assert.match(textOf(result), /PDF paragraph/)
  assert.match(textOf(result), /Native text can lose reading order/)
  assert.equal(result.isError, undefined)
})

test('read_page distinguishes scans and unavailable PDF pages and rejects HTML selectors with PDF pages', async () => {
  let available = true
  const { call } = harness({ readPage: async () => ({
    url: 'https://a.test/scan.pdf', title: 'Scan', readyState: 'complete', text: '', truncated: false,
    pdf: { page: 1, totalPages: 1, pagesAvailable: available ? 1 : 0, available }
  }) })
  assert.match(textOf(await call({ action: 'read_page' })), /No native text.*scanned, blank, or inaccessible/)
  available = false
  const missing = await call({ action: 'read_page' })
  assert.equal(missing.isError, true)
  assert.match(textOf(missing), /PDF page 1 is unavailable/)
  const invalid = await call({ action: 'read_page', selector: 'body', pdf_page: 1 })
  assert.equal(invalid.errorKind, 'usage')
})

test('browser tool advertises page and deferred script tools', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['embedded_browser.page', 'embedded_browser.script'])
  assert.deepEqual(registry.namespaces[0].tools[0].actions?.map((action) => action.name), [
    'navigate', 'read_page', 'wait_for'
  ])
  assert.deepEqual(registry.namespaces[0].tools[1].actions?.map((action) => action.name), [
    'fetch', 'extract', 'query', 'evaluate', 'console'
  ])
  assert.equal(registry.namespaces[0].tools[1].deferLoading, true)
})

test('navigate defaults to dom-ready readiness and reports the reached state', async () => {
  const { calls, call } = harness()
  const result = await call({ action: 'navigate', url: 'a.test' })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], ['navigate', 'a.test', { tabId: undefined, newTab: false, ready: { until: 'dom_ready', selector: undefined, text: undefined, timeoutMs: 3_000 } }])
  assert.match(textOf(result), /Loaded: A\nURL: https:\/\/a.test\/\nTab: tab-1\nReady: complete after 0.8s/)
})

test('navigate passes selector, text, timeout, and new_tab through and surfaces failures', async () => {
  const seen: unknown[] = []
  const { call } = harness({ navigate: async (url, options) => { seen.push([url, options]); return { ok: false, error: 'ERR_NAME_NOT_RESOLVED' } } })
  const result = await call({ action: 'navigate', url: 'x', new_tab: true, wait_until: 'load', wait_for_selector: '#r', timeout_ms: 2_000 })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /Navigation to x failed: ERR_NAME_NOT_RESOLVED/)
  assert.deepEqual(seen[0], ['x', { tabId: undefined, newTab: true, ready: { until: 'load', selector: '#r', text: undefined, timeoutMs: 2_000 } }])
})

test('navigate targets an explicit tab and rejects ambiguous new-tab requests', async () => {
  const { calls, call } = harness()
  const targeted = await call({ action: 'navigate', url: 'b.test', tab_id: 'tab-2' })
  assert.equal(targeted.isError, undefined)
  assert.deepEqual(calls[0], ['navigate', 'b.test', {
    tabId: 'tab-2',
    newTab: false,
    ready: { until: 'dom_ready', selector: undefined, text: undefined, timeoutMs: 3_000 }
  }])

  const ambiguous = await call({ action: 'navigate', url: 'c.test', tab_id: 'tab-2', new_tab: true })
  assert.equal(ambiguous.isError, true)
  assert.match(textOf(ambiguous), /cannot combine tab_id with new_tab/)
  assert.equal(calls.length, 1)
})

test('navigate reports a missing explicit tab', async () => {
  const { call } = harness({
    navigate: async (_url, options) => options.tabId === 'missing'
      ? { ok: false, error: 'No tab with id missing' }
      : { ok: true, tabId: 'tab-1', ready }
  })
  const result = await call({ action: 'navigate', url: 'x', tab_id: 'missing' })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /No tab with id missing/)
})

test('read_page returns header, load state, and text; missing tabs fail', async () => {
  const { call } = harness()
  const ok = await call({ action: 'read_page' })
  assert.equal(textOf(ok), 'Title: A\nURL: https://a.test/\nLoad state: complete\n\nHello world')
  const missing = await call({ action: 'read_page', tab_id: 'missing' })
  assert.equal(missing.isError, true)
  // The failure names the live tabs so the next call can succeed without another lookup.
  assert.equal(textOf(missing), 'No tab with id missing. Open tabs: tab-1 (active) "A". Pass one of these, or omit tab_id for the active tab.')
})

test('wait_for reports an unmet wait as a timeout the model can act on, not an error', async () => {
  const { call } = harness()
  const result = await call({ action: 'wait_for', wait_until: 'load', timeout_ms: 1_000 })
  assert.equal(result.isError, true)
  // docs/tools.md promises an unreached condition counts as a timeout, so exploratory waits
  // do not inflate the error count; the registry reads that off errorKind.
  assert.equal(result.errorKind, 'timeout')
  assert.match(textOf(result), /Not ready: still "dom-ready" when the 1s wait ended/)
  // The outcome leads; a truncated log line has to carry the reason, not the page title.
  assert.match(textOf(result), /^Not ready:/)
})

test('read_page separates a rejected selector from one that simply did not match', async () => {
  const invalid = harness({ readPage: async () => ({ problem: 'selector-invalid', detail: "'div:has-text(\"a\")' is not a valid selector." }) })
  const rejected = await invalid.call({ action: 'read_page', selector: 'div:has-text("a")' })
  assert.equal(rejected.errorKind, 'usage')
  assert.match(textOf(rejected), /rejected "div:has-text\(\\"a\\"\)" as a CSS selector/)
  assert.match(textOf(rejected), /Only standard CSS works here/)
  // The claim the old handler made for every null: reserved for the one case that supports it.
  assert.doesNotMatch(textOf(rejected), /Nothing matches/)

  const absent = harness({ readPage: async () => ({ problem: 'selector-missing' }) })
  const missing = await absent.call({ action: 'read_page', selector: '.itemlist' })
  assert.equal(missing.isError, true)
  assert.equal(missing.errorKind, undefined)
  assert.match(textOf(missing), /Nothing matches selector "\.itemlist"\. The selector is valid/)
})

test('read_page says a page went quiet instead of blaming the selector', async () => {
  const { call } = harness({ readPage: async () => ({ problem: 'unavailable' }) })
  const result = await call({ action: 'read_page', selector: '.itemlist' })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /did not answer the read.*navigating/)
  assert.doesNotMatch(textOf(result), /Nothing matches/)
})

test('wait_for rejects a selector the page cannot parse instead of waiting out the timeout', async () => {
  const { call } = harness({
    waitFor: async () => ({
      ...ready, reached: false, conditionMet: false, elapsedMs: 0,
      selectorError: "'div:has-text(\"Appearance\")' is not a valid selector."
    })
  })
  const result = await call({ action: 'wait_for', wait_for_selector: 'div:has-text("Appearance")', timeout_ms: 15_000 })
  assert.equal(result.errorKind, 'usage')
  assert.match(textOf(result), /rejected "div:has-text\(\\"Appearance\\"\)" as a CSS selector, so the wait stopped without testing it/)
  assert.match(textOf(result), /Only standard CSS works here/)
  // "not found" and "Not ready" are both claims about a page this wait never managed to test.
  assert.doesNotMatch(textOf(result), /not found|Not ready/)
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
  const { scriptCall } = jsonHarness(seen)
  const result = await scriptCall({
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

test('fetch bounds a text body at max_chars and says so', async () => {
  const html = '<p>' + 'x'.repeat(500) + '</p>'
  const { scriptCall } = jsonHarness([], { contentType: 'text/html', text: html, bodyLength: html.length })
  const result = await scriptCall({ action: 'fetch', url: '/page', max_chars: 200 })
  const payload = JSON.parse(textOf(result)) as { text: string; textTruncated?: boolean; bodyLength: number }
  assert.equal(payload.text.length, 200)
  assert.equal(payload.textTruncated, true)
  assert.equal(payload.bodyLength, html.length)
})

test('fetch reports a missing tab rather than pretending the request ran', async () => {
  const { scriptCall } = harness()
  const result = await scriptCall({ action: 'fetch', url: '/api', tab_id: 'missing' })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /No tab with id missing/)
})

test('extract returns only the projected fields and reports what it dropped', async () => {
  const { scriptCall } = jsonHarness()
  const result = await scriptCall({ action: 'extract', url: '/api', path: 'data.items', fields: ['name'], limit: 1 })
  const payload = JSON.parse(textOf(result)) as { matched: number; returned: number; limited: boolean; value: unknown }
  assert.deepEqual(payload.value, [{ name: 'One' }])
  assert.equal(payload.matched, 2)
  assert.equal(payload.returned, 1)
  assert.equal(payload.limited, true)
})

test('extract fails with advice when the path or the content is wrong', async () => {
  const { scriptCall } = jsonHarness()
  const noPath = await scriptCall({ action: 'extract', url: '/api', path: 'data.missing' })
  assert.equal(noPath.isError, true)
  assert.match(textOf(noPath), /No value at path "data.missing"/)

  // The default harness page is prose, not JSON: extract should say so instead of half-parsing it.
  const notJson = await scriptCall({ action: 'extract' })
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

test('query passes selector options through and returns the structured result', async () => {
  const { calls, scriptCall } = harness()
  const result = await scriptCall({ action: 'query', selector: 'a.nav', text_contains: 'Docs', attributes: ['data-id'], visible_only: true, max_matches: 5 })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], ['query', undefined, { selector: 'a.nav', text: 'Docs', attributes: ['data-id'], visibleOnly: true, limit: 5, maxText: 200 }])
  assert.equal((JSON.parse(textOf(result)) as { matched: number }).matched, 1)
  const missing = await scriptCall({ action: 'query', selector: 'a', tab_id: 'missing' })
  assert.equal(missing.isError, true)
})

test('evaluate returns the page value as JSON and defaults its bound', async () => {
  const { calls, scriptCall } = harness()
  const result = await scriptCall({ action: 'evaluate', expression: 'document.title' })
  assert.deepEqual(calls[0], ['evaluate', undefined, { expression: 'document.title', maxChars: 20_000 }])
  assert.deepEqual(JSON.parse(textOf(result)), { ok: true, type: 'object', value: { title: 'A' }, truncated: false })
})

test('console forwards its filters and reports a missing tab', async () => {
  const { calls, scriptCall } = harness()
  await scriptCall({ action: 'console', min_level: 'error', since_navigation: true, after_cursor: 3, max_entries: 10 })
  assert.deepEqual(calls[0], ['console', undefined, { minLevel: 'error', contains: undefined, sinceNavigation: true, afterCursor: 3, limit: 10 }])
  const missing = await scriptCall({ action: 'console', tab_id: 'missing' })
  assert.equal(missing.isError, true)
})
