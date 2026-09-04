import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { cdpTools } from './index.js'
import type { CdpToolHost } from './host.js'

function harness(overrides: Partial<CdpToolHost> = {}) {
  const calls: unknown[] = []
  const host: CdpToolHost = {
    capabilities: async (tabId) => { calls.push(['capabilities', tabId]); return { protocolVersion: '1.3' } },
    targets: async (tabId) => { calls.push(['targets', tabId]); return { targets: [] } },
    command: async (tabId, method, params, sessionId) => {
      calls.push(['command', tabId, method, params, sessionId])
      return { result: { value: 4 } }
    },
    events: (tabId, after, limit, prefix) => {
      calls.push(['events', tabId, after, limit, prefix])
      return { tab: {}, connectionId: 'c1', oldestCursor: 1, nextCursor: 2, missedEvents: false, events: [] }
    },
    networkRequests: async (tabId, filter) => {
      calls.push(['networkRequests', tabId, filter])
      return { capturing: true, requests: [{ url: 'https://a.test/api/items', method: 'POST', requestId: '1' }] }
    },
    responseBody: async (tabId, requestId) => {
      calls.push(['responseBody', tabId, requestId])
      return { requestId, text: '{"ok":true}', base64Encoded: false }
    },
    inspectPage: async (tabId, maxElements) => {
      calls.push(['inspectPage', tabId, maxElements])
      return { snapshotId: 'p1', elements: [] }
    },
    clickElement: async (tabId, ref) => {
      calls.push(['clickElement', tabId, ref])
      return { ref, point: { x: 10, y: 20 } }
    },
    clickAt: async (tabId, x, y) => {
      calls.push(['clickAt', tabId, x, y])
      return { point: { x, y } }
    },
    typeText: async (tabId, ref, text, clear) => {
      calls.push(['typeText', tabId, ref, text, clear])
      return { ref, value: text }
    },
    pressKey: async (tabId, key, modifiers) => {
      calls.push(['pressKey', tabId, key, modifiers])
      return { key }
    },
    scrollPage: async (tabId, ref, deltaX, deltaY) => {
      calls.push(['scrollPage', tabId, ref, deltaX, deltaY])
      return { scrolled: ref ? 'into_view' : 'wheel' }
    },
    dismissOverlay: async (tabId, kind, verifyTimeoutMs) => {
      calls.push(['dismissOverlay', tabId, kind, verifyTimeoutMs])
      return { dismissed: true }
    },
    ...overrides
  } as CdpToolHost
  const registry = new ToolRegistry([cdpTools(() => host)])
  const call = (arguments_: Record<string, unknown>) => registry.call(
    { namespace: 'browser_cdp', tool: 'protocol', arguments: arguments_ },
    { threadId: null, turnId: null, callId: 'call-1' }
  )
  return { calls, call, registry }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('CDP tool advertises its foundational protocol and target lifecycle actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['browser_cdp.protocol', 'browser_cdp.page'])
  assert.deepEqual(registry.namespaces[0].tools[0].actions?.map((action) => action.name), [
    'capabilities', 'targets', 'command', 'target', 'events', 'requests', 'body'
  ])
})

test('requests lists network traffic and body reads one captured response', async () => {
  const { calls, call } = harness()
  const listed = await call({ action: 'requests', url_contains: '/api/', max_requests: 5 })
  assert.match(textOf(listed), /"method": "POST"/)
  assert.deepEqual(calls.at(-1), ['networkRequests', undefined, { url: '/api/', type: undefined, limit: 5 }])

  const body = await call({ action: 'body', request_id: '1', tab_id: 'tab-2' })
  assert.match(textOf(body), /\\"ok\\":true/)
  assert.deepEqual(calls.at(-1), ['responseBody', 'tab-2', '1'])

  const missing = await call({ action: 'body' })
  assert.equal(missing.isError, true)
})

test('agent page wrapper inspects and clicks refs or explicit coordinates', async () => {
  const { calls, registry } = harness()
  const callPage = (arguments_: Record<string, unknown>) => registry.call(
    { namespace: 'browser_cdp', tool: 'page', arguments: arguments_ },
    { threadId: null, turnId: null, callId: 'call-page' }
  )
  assert.match(textOf(await callPage({ action: 'inspect_page', tab_id: 'tab-3' })), /"snapshotId": "p1"/)
  await callPage({ action: 'click', ref: 'p1:main:e1', fallback_reason: 'No endpoint exposes this control.' })
  await callPage({ action: 'click_at', x: 12.5, y: 18, coordinate_space: 'main_viewport_css', fallback_reason: 'No semantic ref was available.' })
  assert.deepEqual(calls, [
    ['inspectPage', 'tab-3', 200],
    ['clickElement', undefined, 'p1:main:e1'],
    ['clickAt', undefined, 12.5, 18]
  ])
})

test('capabilities and targets default to the active ClosedAI tab', async () => {
  const { calls, call } = harness()
  assert.match(textOf(await call({ action: 'capabilities' })), /"protocolVersion": "1.3"/)
  await call({ action: 'targets', tab_id: 'tab-4' })
  assert.deepEqual(calls, [['capabilities', undefined], ['targets', 'tab-4']])
})

test('command passes arbitrary params and a flat child session id', async () => {
  const { calls, call } = harness()
  const result = await call({
    action: 'command',
    tab_id: 'tab-2',
    method: 'Runtime.evaluate',
    params: { expression: '2 + 2', awaitPromise: true },
    session_id: 'child-8'
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], [
    'command', 'tab-2', 'Runtime.evaluate', { expression: '2 + 2', awaitPromise: true }, 'child-8'
  ])
})

test('target lifecycle operations use raw Target commands and return refreshed inventory', async () => {
  const { calls, call } = harness()
  const result = await call({ action: 'target', operation: 'attach', target_id: 'worker-7', tab_id: 'tab-2' })
  assert.equal(result.isError, undefined)
  assert.match(textOf(result), /"operation": "attach"/)
  assert.deepEqual(calls, [
    ['command', 'tab-2', 'Target.attachToTarget', { targetId: 'worker-7', flatten: true }, undefined],
    ['targets', 'tab-2']
  ])

  const missingTarget = await call({ action: 'target', operation: 'close' })
  assert.equal(missingTarget.isError, true)
  assert.match(textOf(missingTarget), /`target_id` is required/)

  const detached = await call({ action: 'target', operation: 'detach', session_id: 'child-8' })
  assert.equal(detached.isError, undefined)
  assert.deepEqual(calls.slice(-2), [
    ['command', undefined, 'Target.detachFromTarget', { sessionId: 'child-8' }, undefined],
    ['targets', undefined]
  ])
  const missingSession = await call({ action: 'target', operation: 'detach' })
  assert.equal(missingSession.isError, true)
  assert.match(textOf(missingSession), /`session_id` is required/)
})

test('events use cursor defaults and accept method-prefix filtering', async () => {
  const { calls, call } = harness()
  await call({ action: 'events', method_prefix: 'Network.' })
  assert.deepEqual(calls[0], ['events', undefined, 0, 100, 'Network.'])
})

test('page input verbs route typing, key chords, and scrolling to the host', async () => {
  const { calls, registry } = harness()
  const callPage = (arguments_: Record<string, unknown>) => registry.call(
    { namespace: 'browser_cdp', tool: 'page', arguments: arguments_ },
    { threadId: null, turnId: null, callId: 'call-input' }
  )
  await callPage({ action: 'type', ref: 'p1:main:e2', text: 'hello', clear: false, fallback_reason: 'The site has no writable API.' })
  await callPage({ action: 'press_key', key: 'Enter', modifiers: ['ctrl'], fallback_reason: 'The form only submits from a key chord.' })
  await callPage({ action: 'scroll', ref: 'p1:main:e3' })
  await callPage({ action: 'scroll', delta_y: 500 })
  assert.deepEqual(calls, [
    ['typeText', undefined, 'p1:main:e2', 'hello', false],
    ['pressKey', undefined, 'Enter', ['ctrl']],
    ['scrollPage', undefined, 'p1:main:e3', 0, 0],
    ['scrollPage', undefined, undefined, 0, 500]
  ])
  const badModifier = await callPage({ action: 'press_key', key: 'Enter', modifiers: ['hyper'], fallback_reason: 'Testing validation.' })
  assert.equal(badModifier.isError, true)
})

test('raw input commands require an auditable fallback reason while screenshots remain ordinary commands', async () => {
  const { calls, call, registry } = harness()
  assert.equal(registry.namespaces[0]!.tools[0]!.deferLoading, undefined)
  const refused = await call({ action: 'command', method: 'Input.dispatchKeyEvent', params: { type: 'keyDown' } })
  assert.equal(refused.isError, true)
  assert.match(textOf(refused), /fallback_reason/)
  const input = await call({
    action: 'command',
    method: 'Input.dispatchKeyEvent',
    params: { type: 'keyDown' },
    fallback_reason: 'No deterministic submit operation exists.'
  })
  assert.equal(input.isError, undefined)
  const screenshot = await call({ action: 'command', method: 'Page.captureScreenshot' })
  assert.equal(screenshot.isError, undefined)
  assert.deepEqual(calls, [
    ['command', undefined, 'Input.dispatchKeyEvent', { type: 'keyDown' }, undefined],
    ['command', undefined, 'Page.captureScreenshot', {}, undefined]
  ])
})

test('semantic real-input actions reject calls without a fallback reason before reaching the host', async () => {
  const { calls, registry } = harness()
  const callPage = (arguments_: Record<string, unknown>) => registry.call(
    { namespace: 'browser_cdp', tool: 'page', arguments: arguments_ },
    { threadId: null, turnId: null, callId: 'call-policy' }
  )
  for (const arguments_ of [
    { action: 'click', ref: 'p1:main:e1' },
    { action: 'click_at', x: 1, y: 2 },
    { action: 'type', ref: 'p1:main:e2', text: 'hello' },
    { action: 'press_key', key: 'Enter' },
    { action: 'dismiss_overlay' }
  ]) {
    const result = await callPage(arguments_)
    assert.equal(result.isError, true)
    assert.match(textOf(result), /fallback_reason/)
  }
  const blank = await callPage({ action: 'click', ref: 'p1:main:e1', fallback_reason: '   ' })
  assert.equal(blank.isError, true)
  assert.match(textOf(blank), /fallback_reason/)
  assert.deepEqual(calls, [])
})

test('command validates CDP method syntax and action-specific fields', async () => {
  const { call } = harness()
  const invalidMethod = await call({ action: 'command', method: 'evaluate' })
  assert.equal(invalidMethod.isError, true)
  assert.match(textOf(invalidMethod), /Domain\.method syntax/)

  const wrongField = await call({ action: 'targets', params: {} })
  assert.equal(wrongField.isError, true)
  assert.match(textOf(wrongField), /not a recognised argument/)
})
