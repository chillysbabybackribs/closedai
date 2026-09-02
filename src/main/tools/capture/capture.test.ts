import assert from 'node:assert/strict'
import test from 'node:test'
import type { PageReadyResult } from '../../browser-page-ready.js'
import { ToolRegistry } from '../registry.js'
import type { UiCaptureHost } from './host.js'
import { CaptureBudget, captureTools } from './index.js'
import { ScreenshotStore } from './screenshot-store.js'

const image = {
  dataUrl: 'data:image/png;base64,cG5n', width: 1920, height: 1080, capturedAt: '2026-09-02T12:00:00.000Z',
  model: { dataUrl: 'data:image/jpeg;base64,anBn', width: 1280, height: 720 }
}
const ready: PageReadyResult = {
  readyState: 'complete', reached: true, conditionMet: true, elapsedMs: 600,
  url: 'https://a.test/', title: 'A'
}

function harness(overrides: Partial<UiCaptureHost> = {}, budget = new CaptureBudget()) {
  const calls: unknown[] = []
  const host: UiCaptureHost = {
    captureAppWindow: async () => { calls.push(['app']); return image },
    captureBrowserPage: async (tabId, readiness) => {
      calls.push(['page', tabId, readiness])
      return { image, tabId: tabId ?? 'tab-1', url: ready.url, title: ready.title, ready }
    },
    cropImage: async (dataUrl, crop, zoom) => {
      calls.push(['crop', dataUrl, crop, zoom])
      return image
    },
    ...overrides
  }
  const store = new ScreenshotStore()
  const registry = new ToolRegistry([captureTools(() => host, store, budget)])
  const call = (args: Record<string, unknown>, callId = 'c', turnId: string | null = null) => registry.call(
    { namespace: 'closedai_ui', tool: 'capture', arguments: args },
    { threadId: null, turnId, callId }
  )
  return { calls, call, registry, store }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('capture tool advertises one tool with capture and crop actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['closedai_ui.capture'])
  const actions = registry.namespaces[0].tools[0].actions
  assert.deepEqual(actions?.map((action) => action.name), ['app_window', 'browser_page', 'crop'])
  const cropProperties = actions?.find((action) => action.name === 'crop')?.inputSchema.properties
  assert.deepEqual((cropProperties as Record<string, Record<string, unknown>>).zoom.type, 'number')
})

test('app_window hands the model the scaled image and keeps the full capture for the transcript', async () => {
  const { calls, call, store } = harness()
  const result = await call({ action: 'app_window' }, 'call_1')
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls, [['app']])
  assert.match(textOf(result), /Surface: application window\nCapture ID: call_1\nImage: 1280x720/)
  assert.deepEqual(result.content[1], { type: 'image', dataUrl: image.model.dataUrl })
  assert.deepEqual(store.get('call_1'), {
    dataUrl: image.dataUrl,
    width: 1920,
    height: 1080,
    modelWidth: 1280,
    modelHeight: 720,
    surface: 'app_window',
    capturedAt: image.capturedAt
  })
})

test('an unscaled capture reports one size and is still retained', async () => {
  const same = { ...image, model: { dataUrl: image.dataUrl, width: image.width, height: image.height } }
  const { call, store } = harness({ captureAppWindow: async () => same })
  const result = await call({ action: 'app_window' }, 'call_2')
  assert.match(textOf(result), /Image: 1920x1080\nCaptured:/)
  assert.equal(store.get('call_2')?.surface, 'app_window')
})

test('browser_page defaults to a dom-ready wait and passes deterministic conditions', async () => {
  const { calls, call } = harness()
  const result = await call({ action: 'browser_page', tab_id: 'tab-4', wait_for_selector: '#done', timeout_ms: 2_000 })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], ['page', 'tab-4', {
    until: 'dom_ready', selector: '#done', text: undefined, timeoutMs: 2_000
  }])
  assert.match(textOf(result), /Page: A\nURL: https:\/\/a.test\/\nTab: tab-4\nReady: dom-ready/)
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

test('crop maps model-image coordinates to the retained full-resolution screenshot', async () => {
  const { call, calls, store } = harness()
  await call({ action: 'app_window' }, 'source_1')
  calls.length = 0

  const result = await call({
    action: 'crop', source_id: 'source_1', x: 100, y: 50, width: 400, height: 300, zoom: 1.2
  }, 'crop_1')

  assert.equal(result.isError, undefined)
  assert.deepEqual(calls, [['crop', image.dataUrl, { x: 150, y: 75, width: 600, height: 450 }, 1.2]])
  assert.match(textOf(result), /Crop of: source_1\nRegion: \(100, 50\) 400x300 of 1280x720\nZoom: 1\.2x/)
  assert.equal(store.get('crop_1')?.surface, 'crop')
})

test('crop rejects missing, evicted, and out-of-bounds source regions', async () => {
  const { call, calls } = harness()
  const missing = await call({ action: 'crop', source_id: 'gone', x: 0, y: 0, width: 1, height: 1 })
  assert.equal(missing.isError, true)
  assert.match(textOf(missing), /No retained screenshot with Capture ID gone/)

  await call({ action: 'app_window' }, 'source_2')
  calls.length = 0
  const outside = await call({
    action: 'crop', source_id: 'source_2', x: 1200, y: 700, width: 100, height: 30
  })
  assert.equal(outside.isError, true)
  assert.match(textOf(outside), /exceeds source image 1280x720/)
  assert.deepEqual(calls, [])

  const invalidZoom = await call({
    action: 'crop', source_id: 'source_2', x: 0, y: 0, width: 100, height: 100, zoom: 5
  })
  assert.equal(invalidZoom.isError, true)
  assert.match(textOf(invalidZoom), /capture: invalid arguments — \$\.zoom must be <= 4/)

  const shrinkingZoom = await call({
    action: 'crop', source_id: 'source_2', x: 0, y: 0, width: 100, height: 100, zoom: 0.9
  })
  assert.equal(shrinkingZoom.isError, true)
  assert.match(textOf(shrinkingZoom), /capture: invalid arguments — \$\.zoom must be >= 1/)
})

test('each turn gets a bounded number of images across all capture actions', async () => {
  const { call, calls } = harness({}, new CaptureBudget(2))
  const first = await call({ action: 'app_window' }, 'c1', 'turn-1')
  assert.match(textOf(first), /Images left this turn: 1$/)
  const second = await call({ action: 'browser_page' }, 'c2', 'turn-1')
  assert.match(textOf(second), /Images left this turn: 0$/)
  const third = await call({ action: 'crop', source_id: 'c1', x: 0, y: 0, width: 10, height: 10 }, 'c3', 'turn-1')
  assert.equal(third.isError, true)
  assert.match(textOf(third), /Screenshot budget reached: 2 images/)
  assert.equal(calls.length, 2, 'the host is not asked for a capture past the budget')
  const nextTurn = await call({ action: 'app_window' }, 'c4', 'turn-2')
  assert.notEqual(nextTurn.isError, true)
  assert.match(textOf(nextTurn), /Images left this turn: 1$/)
})

test('a heavily scaled capture tells the model to crop rather than re-capture', async () => {
  const wide = { ...image, width: 2560, height: 1080, model: { ...image.model, width: 1280, height: 540 } }
  const { call } = harness({ captureAppWindow: async () => wide })
  const result = await call({ action: 'app_window' })
  assert.match(textOf(result), /Scaled to 50%: small text may be unreadable\. Use crop with zoom/)
  const mild = await harness().call({ action: 'app_window' })
  assert.doesNotMatch(textOf(mild), /Scaled to/)
})
