import assert from 'node:assert/strict'
import test from 'node:test'
import { configureChromiumStartup, linuxHardwareVideoDecodeEnabled } from './chromium-startup-policy.js'

function configure(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) {
  const switches: Array<[string, string | undefined]> = []
  configureChromiumStartup(
    { commandLine: { appendSwitch: (name, value) => switches.push([name, value]) } },
    platform,
    env
  )
  return switches
}

test('Linux video decode follows the Chromium 152+ default policy', () => {
  const env: NodeJS.ProcessEnv = {}
  const base: Array<[string, string | undefined]> = [
    ['enable-features', 'SpareRendererForSitePerProcess'],
    ['xdg-portal-required-version', '999'],
    ['no-sandbox', undefined]
  ]
  const switches = configure('linux', env)
  assert.deepEqual(
    switches,
    linuxHardwareVideoDecodeEnabled({}) ? base : [...base, ['disable-accelerated-video-decode', undefined]]
  )
  assert.equal(env.GTK_USE_PORTAL, '0')
})

test('Linux hardware video decode can be forced off or on explicitly', () => {
  assert.equal(linuxHardwareVideoDecodeEnabled({ CLOSEDAI_DISABLE_HARDWARE_VIDEO_DECODE: '1' }), false)
  assert.equal(linuxHardwareVideoDecodeEnabled({ CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE: '1' }), true)
  assert.deepEqual(configure('linux', { CLOSEDAI_DISABLE_HARDWARE_VIDEO_DECODE: '1' }), [
    ['enable-features', 'SpareRendererForSitePerProcess'],
    ['xdg-portal-required-version', '999'],
    ['no-sandbox', undefined],
    ['disable-accelerated-video-decode', undefined]
  ])
})

test('non-Linux startup enables the spare renderer only', () => {
  const env: NodeJS.ProcessEnv = {}
  assert.deepEqual(configure('darwin', env), [
    ['enable-features', 'SpareRendererForSitePerProcess']
  ])
  assert.equal(env.GTK_USE_PORTAL, undefined)
})
