import assert from 'node:assert/strict'
import test from 'node:test'
import type { PageReadyResult } from '../../browser-page-ready.js'
import { ToolRegistry } from '../registry.js'
import type { UiCaptureHost } from './host.js'
import { captureTools } from './index.js'
import { ScreenshotStore } from './screenshot-store.js'

const image = {
  dataUrl: 'data:image/png;base64,cG5n', width: 1920, height: 1080, capturedAt: '2026-09-02T12:00:00.000Z',
  model: { dataUrl: 'data:image/jpeg;base64,anBn', width: 1280, height: 720 }
}
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
  const store = new ScreenshotStore()
  const registry = new ToolRegistry([captureTools(() => host, store)])
  const call = (args: Record<string, unknown>, callId = 'c') => registry.call(
    { namespace: 'closedai_ui', tool: 'capture', arguments: args },
    { threadId: null, turnId: null, callId }
  )
  return { calls, call, registry, store }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('capture tool advertises one tool with two visual-read actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['closedai_ui.capture'])
  assert.deepEqual(registry.namespaces[0].tools[0].actions?.map((action) => action.name), ['app_window', 'browser_page'])
})

test('app_window hands the model the scaled image and keeps the full capture for the transcript', async () => {
  const { calls, call, store } = harness()
  const result = await call({ action: 'app_window' }, 'call_1')
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls, [['app']])
  assert.match(textOf(result), /Surface: application window\nImage: 1280x720 \(scaled from 1920x1080; the user sees the full capture\)/)
  assert.deepEqual(result.content[1], { type: 'image', dataUrl: image.model.dataUrl })
  assert.deepEqual(store.get('call_1'), {
    dataUrl: image.dataUrl, width: 1920, height: 1080, surface: 'app_window', capturedAt: image.capturedAt
  })
})

test('an unscaled capture reports one size and is still retained', async () => {
  const same = { ...image, model: { dataUrl: image.dataUrl, width: image.width, height: image.height } }
  const { call, store } = harness({ captureAppWindow: async () => same })
  const result = await call({ action: 'app_window' }, 'call_2')
  assert.match(textOf(result), /Image: 1920x1080\nCaptured:/)
  assert.equal(store.get('call_2')?.surface, 'app_window')
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
