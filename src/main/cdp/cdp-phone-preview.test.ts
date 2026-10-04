import assert from 'node:assert/strict'
import test from 'node:test'
import { PHONE_VIEWPORT, phonePreviewLayout } from '../../shared/phone-preview.js'
import { applyPhonePreview, clearPhonePreview } from './cdp-phone-preview.js'

function recorder(fail: string[] = []) {
  const calls: { method: string; params?: Record<string, unknown> }[] = []
  const send = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params })
    if (fail.includes(method)) throw new Error(`${method} failed`)
    return {}
  }
  return { calls, send }
}

test('a fitted phone renders the full viewport width at the surface scale and resets page zoom last', async () => {
  const layout = phonePreviewLayout({ width: 1054, height: 700 })
  const { calls, send } = recorder()
  let embedded: { viewSize: { width: number; height: number } } | null = null
  await applyPhonePreview({ enableDeviceEmulation: (parameters) => { embedded = parameters } }, send, layout, { initial: true })

  assert.deepEqual(embedded!.viewSize, { width: layout.page.width, height: layout.page.height })
  const metrics = calls.find((call) => call.method === 'Emulation.setDeviceMetricsOverride')!.params!
  assert.equal(metrics.width, PHONE_VIEWPORT.width)
  assert.equal(metrics.mobile, true)
  assert.equal(metrics.scale, layout.page.width / PHONE_VIEWPORT.width)
  assert.ok(calls.some((call) => call.method === 'Emulation.setUserAgentOverride'))
  assert.equal(calls.at(-1)!.method, 'Emulation.setPageScaleFactor')
})

test('a resize re-applies metrics without re-sending touch or user agent', async () => {
  const { calls, send } = recorder()
  await applyPhonePreview({ enableDeviceEmulation: () => {} }, send, phonePreviewLayout({ width: 900, height: 600 }), { initial: false })
  assert.deepEqual(calls.map((call) => call.method), ['Emulation.setDeviceMetricsOverride', 'Emulation.setPageScaleFactor'])
})

test('clearing keeps going past a failed command', async () => {
  const { calls, send } = recorder(['Emulation.clearDeviceMetricsOverride'])
  let disabled = false
  await clearPhonePreview({ disableDeviceEmulation: () => { disabled = true } }, send)
  assert.equal(disabled, true)
  assert.equal(calls.length, 4)
})
