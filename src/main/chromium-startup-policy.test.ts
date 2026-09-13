import assert from 'node:assert/strict'
import test from 'node:test'
import { configureChromiumStartup } from './chromium-startup-policy.js'

function configure(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) {
  const switches: Array<[string, string | undefined]> = []
  configureChromiumStartup(
    { commandLine: { appendSwitch: (name, value) => switches.push([name, value]) } },
    platform,
    env
  )
  return switches
}

test('Linux keeps GPU compositing but forces broken video decode onto software', () => {
  const env: NodeJS.ProcessEnv = {}
  assert.deepEqual(configure('linux', env), [
    ['enable-features', 'SpareRendererForSitePerProcess'],
    ['xdg-portal-required-version', '999'],
    ['no-sandbox', undefined],
    ['disable-accelerated-video-decode', undefined]
  ])
  assert.equal(env.GTK_USE_PORTAL, '0')
})

test('Linux hardware video decode has an explicit verified-machine escape hatch', () => {
  assert.deepEqual(configure('linux', { CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE: '1' }), [
    ['enable-features', 'SpareRendererForSitePerProcess'],
    ['xdg-portal-required-version', '999'],
    ['no-sandbox', undefined]
  ])
})

test('non-Linux startup enables the spare renderer only', () => {
  const env: NodeJS.ProcessEnv = {}
  assert.deepEqual(configure('darwin', env), [
    ['enable-features', 'SpareRendererForSitePerProcess']
  ])
  assert.equal(env.GTK_USE_PORTAL, undefined)
})
