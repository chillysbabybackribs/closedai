import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyEmulation,
  emulationParameters,
  resetEmulation,
  resolvePreset,
  type DeviceEmulationParameters
} from './cdp-emulate.js'

type Viewport = { width: number; height: number } | null

function fakeTarget() {
  const calls: { enabled: DeviceEmulationParameters[]; disabled: number; viewports: Viewport[] } =
    { enabled: [], disabled: 0, viewports: [] }
  return {
    calls,
    enableDeviceEmulation(parameters: DeviceEmulationParameters) { calls.enabled.push(parameters) },
    disableDeviceEmulation() { calls.disabled += 1 },
    setEmulatedViewport(size: Viewport) { calls.viewports.push(size) }
  }
}

function recorder(page: Record<string, unknown> = {}) {
  const sent: { method: string; params: Record<string, unknown> }[] = []
  const send = async (method: string, params: Record<string, unknown> = {}) => {
    sent.push({ method, params })
    return method === 'Runtime.evaluate' ? { result: { value: page } } : {}
  }
  return { sent, send }
}

test('a preset resolves fully and individual fields override parts of it', () => {
  assert.deepEqual(resolvePreset({ device: 'iphone-15' })?.width, 393)
  assert.equal(resolvePreset({ device: 'iphone-15', width: 400 })?.width, 400)
  assert.equal(resolvePreset({ device: 'iphone-15', width: 400 })?.height, 852)
  assert.equal(resolvePreset({}), null)
  assert.throws(() => resolvePreset({ device: 'nokia-3310' }), /device must be one of/)
  assert.throws(() => resolvePreset({ width: 400 }), /width and height must be given together/)
  assert.deepEqual(resolvePreset({ width: 400, height: 800 }), {
    width: 400, height: 800, deviceScaleFactor: 1, mobile: false, userAgent: undefined
  })
})

test('emulation parameters carry the view size, which is what CDP alone cannot move', () => {
  assert.deepEqual(emulationParameters({ width: 393, height: 852, deviceScaleFactor: 3, mobile: true }), {
    screenPosition: 'mobile',
    screenSize: { width: 393, height: 852 },
    viewSize: { width: 393, height: 852 },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 3,
    scale: 1
  })
  assert.equal(emulationParameters({ width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }).screenPosition, 'desktop')
})

test('apply drives the embedder for size, CDP for the rest, and reports the page reading', async () => {
  const target = fakeTarget()
  const { sent, send } = recorder({ innerWidth: 393, timeZone: 'Asia/Tokyo' })
  const outcome = await applyEmulation(target, send, {
    device: 'iphone-15',
    colorScheme: 'dark',
    timezone: 'Asia/Tokyo',
    locale: 'ja-JP',
    latitude: 35.68,
    longitude: 139.65,
    network: 'slow-3g',
    cpuThrottle: 4
  })

  assert.equal(target.calls.enabled.length, 1)
  assert.deepEqual(target.calls.enabled[0].viewSize, { width: 393, height: 852 })
  // The host surface must move too: the protocol override alone leaves innerWidth untouched.
  assert.deepEqual(target.calls.viewports, [{ width: 393, height: 852 }])
  const methods = sent.map((call) => call.method)
  assert.ok(methods.includes('Emulation.setUserAgentOverride'))
  assert.ok(methods.includes('Emulation.setTimezoneOverride'))
  assert.ok(methods.includes('Emulation.setLocaleOverride'))
  assert.ok(methods.includes('Emulation.setGeolocationOverride'))
  assert.ok(methods.includes('Emulation.setCPUThrottlingRate'))
  assert.deepEqual(
    sent.find((call) => call.method === 'Network.emulateNetworkConditions')?.params,
    { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 }
  )
  assert.deepEqual(outcome.page, { innerWidth: 393, timeZone: 'Asia/Tokyo' })
  assert.ok(outcome.applied.some((entry) => entry.startsWith('viewport 393x852')))
})

test('only the requested overrides are sent', async () => {
  const target = fakeTarget()
  const { sent, send } = recorder()
  await applyEmulation(target, send, { colorScheme: 'dark' })

  assert.equal(target.calls.enabled.length, 0)
  assert.deepEqual(target.calls.viewports, [])
  assert.deepEqual(sent.map((call) => call.method), ['Emulation.setEmulatedMedia', 'Runtime.evaluate'])
  await assert.rejects(applyEmulation(target, send, { network: 'dial-up' }), /network must be one of/)
})

test('reset disables embedder emulation and survives domains that were never enabled', async () => {
  const target = fakeTarget()
  const sent: string[] = []
  const outcome = await resetEmulation(target, async (method) => {
    sent.push(method)
    if (method === 'Emulation.setLocaleOverride') throw new Error('not enabled')
    return method === 'Runtime.evaluate' ? { result: { value: { innerWidth: 1120 } } } : {}
  })

  assert.equal(target.calls.disabled, 1)
  assert.deepEqual(target.calls.viewports, [null])
  assert.ok(sent.includes('Emulation.clearDeviceMetricsOverride'))
  assert.ok(sent.includes('Network.emulateNetworkConditions'))
  assert.ok(!outcome.applied.includes('Emulation.setLocaleOverride'))
  assert.deepEqual(outcome.page, { innerWidth: 1120 })
})
