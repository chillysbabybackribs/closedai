import assert from 'node:assert/strict'
import test from 'node:test'
import { chromiumSandboxDisabled, configureChromiumStartup, linuxHardwareVideoDecodeEnabled } from './chromium-startup-policy.js'

function configure(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) {
  const switches: Array<[string, string | undefined]> = []
  configureChromiumStartup(
    { commandLine: { appendSwitch: (name, value) => switches.push([name, value]) } },
    platform,
    env
  )
  return switches
}

test('Linux keeps the sandbox on and uses reliable software video decode by default', () => {
  const env: NodeJS.ProcessEnv = {}
  const switches = configure('linux', env)
  assert.deepEqual(switches, [
    ['enable-features', 'SpareRendererForSitePerProcess'],
    ['xdg-portal-required-version', '999'],
    ['disable-accelerated-video-decode', undefined]
  ])
  assert.equal(linuxHardwareVideoDecodeEnabled({}), false)
  assert.equal(env.GTK_USE_PORTAL, '0')
})

test('CLOSEDAI_NO_SANDBOX=1 is the only way to append no-sandbox', () => {
  assert.equal(chromiumSandboxDisabled({}), false)
  assert.equal(chromiumSandboxDisabled({ CLOSEDAI_NO_SANDBOX: '0' }), false)
  assert.equal(chromiumSandboxDisabled({ CLOSEDAI_NO_SANDBOX: 'true' }), false)
  assert.equal(chromiumSandboxDisabled({ CLOSEDAI_NO_SANDBOX: '1' }), true)
  assert.deepEqual(configure('linux', { CLOSEDAI_NO_SANDBOX: '1' }), [
    ['enable-features', 'SpareRendererForSitePerProcess'],
    ['no-sandbox', undefined],
    ['xdg-portal-required-version', '999'],
    ['disable-accelerated-video-decode', undefined]
  ])
  // The legacy Electron variable alone does not reach the switch list; only the launcher maps it.
  assert.ok(!configure('linux', { ELECTRON_DISABLE_SANDBOX: '1' }).some(([name]) => name === 'no-sandbox'))
})

test('Linux hardware video decode can be forced off or on explicitly', () => {
  assert.equal(linuxHardwareVideoDecodeEnabled({ CLOSEDAI_DISABLE_HARDWARE_VIDEO_DECODE: '1' }), false)
  assert.equal(linuxHardwareVideoDecodeEnabled({ CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE: '1' }), true)
  assert.equal(linuxHardwareVideoDecodeEnabled({
    CLOSEDAI_DISABLE_HARDWARE_VIDEO_DECODE: '1',
    CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE: '1'
  }), false)
  assert.deepEqual(configure('linux', { CLOSEDAI_DISABLE_HARDWARE_VIDEO_DECODE: '1' }), [
    ['enable-features', 'SpareRendererForSitePerProcess'],
    ['xdg-portal-required-version', '999'],
    ['disable-accelerated-video-decode', undefined]
  ])
  assert.deepEqual(configure('linux', { CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE: '1' }), [
    ['enable-features', 'SpareRendererForSitePerProcess'],
    ['xdg-portal-required-version', '999']
  ])
})

test('non-Linux startup enables the spare renderer only', () => {
  const env: NodeJS.ProcessEnv = {}
  assert.deepEqual(configure('darwin', env), [
    ['enable-features', 'SpareRendererForSitePerProcess']
  ])
  assert.equal(env.GTK_USE_PORTAL, undefined)
})
