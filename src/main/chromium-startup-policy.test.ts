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
    ['xdg-portal-required-version', '999'],
    ['no-sandbox', undefined],
    ['disable-accelerated-video-decode', undefined]
  ])
  assert.equal(env.GTK_USE_PORTAL, '0')
})

test('Linux hardware video decode has an explicit verified-machine escape hatch', () => {
  assert.deepEqual(configure('linux', { CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE: '1' }), [
    ['xdg-portal-required-version', '999'],
    ['no-sandbox', undefined]
  ])
})

test('non-Linux startup is unchanged', () => {
  const env: NodeJS.ProcessEnv = {}
  assert.deepEqual(configure('darwin', env), [])
  assert.equal(env.GTK_USE_PORTAL, undefined)
})
