import assert from 'node:assert/strict'
import test from 'node:test'
import type { PageReadyResult } from '../../browser-page-ready.js'
import { ToolRegistry } from '../registry.js'
import type { UiCaptureHost } from './host.js'
import { captureTools } from './index.js'

const image = { dataUrl: 'data:image/png;base64,cG5n', width: 1200, height: 800, capturedAt: '2026-09-02T12:00:00.000Z' }
const ready: PageReadyResult = {
  readyState: 'complete', reached: true, conditionMet: true, elapsedMs: 600,
  url: 'https://a.test/', title: 'A'
}

function harness(overrides: Partial<UiCaptureHost> = {}) {
  const calls: unknown[] = []
  const host: UiCaptureHost = {
    captureAppWindow: async () => { calls.push(['app']); return image },
    captureBrowserPage: async (tabId, readiness) => {
      calls.push(['page', tabId, readiness])
      return { image, tabId: tabId ?? 'tab-1', url: ready.url, title: ready.title, ready }
    },
    ...overrides
  }
  const registry = new ToolRegistry([captureTools(() => host)])
  const call = (args: Record<string, unknown>) => registry.call(
    { namespace: 'closedai_ui', tool: 'capture', arguments: args },
    { threadId: null, turnId: null, callId: 'c' }
  )
  return { calls, call, registry }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('capture tool advertises one tool with two visual-read actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['closedai_ui.capture'])
  assert.deepEqual(registry.namespaces[0].tools[0].actions?.map((action) => action.name), ['app_window', 'browser_page'])
})

test('app_window returns a composed image with metadata', async () => {
  const { calls, call } = harness()
  const result = await call({ action: 'app_window' })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls, [['app']])
  assert.match(textOf(result), /Surface: application window\nImage: 1200x800/)
  assert.deepEqual(result.content[1], { type: 'image', dataUrl: image.dataUrl })
})

test('browser_page defaults to an idle wait and passes deterministic conditions', async () => {
  const { calls, call } = harness()
  const result = await call({ action: 'browser_page', tab_id: 'tab-4', wait_for_selector: '#done', timeout_ms: 2_000 })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], ['page', 'tab-4', {
    until: 'idle', selector: '#done', text: undefined, timeoutMs: 2_000
  }])
  assert.match(textOf(result), /Page: A\nURL: https:\/\/a.test\/\nTab: tab-4\nReady: complete and idle/)
  assert.equal(result.content[1].type, 'image')
})

test('browser_page refuses an image when readiness was not reached', async () => {
  const waiting = { ...ready, reached: false, conditionMet: false, readyState: 'interactive', elapsedMs: 1_000 }
  const { call } = harness({
    captureBrowserPage: async () => ({ image: null, tabId: 'tab-1', url: ready.url, title: ready.title, ready: waiting })
  })
  const result = await call({ action: 'browser_page', wait_for_text: 'Done', timeout_ms: 1_000 })
  assert.equal(result.isError, true)
  assert.equal(result.content.length, 1)
  assert.match(textOf(result), /Not ready: still "dom-ready"/)
  assert.match(textOf(result), /Text "Done": not present/)
})

test('arguments are validated against the selected capture action', async () => {
  const { call } = harness()
  const result = await call({ action: 'app_window', tab_id: 'tab-1' })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /capture\.app_window: invalid arguments — \$\.tab_id is not a recognised argument/)
})
