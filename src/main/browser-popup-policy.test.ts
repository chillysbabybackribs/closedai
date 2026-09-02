import assert from 'node:assert/strict'
import test from 'node:test'
import { decideWindowOpen } from './browser-popup-policy.ts'

const referrer = { url: 'https://source.example/', policy: 'strict-origin-when-cross-origin' as const }

test('normal page-requested windows become CodeApp tabs', () => {
  const decision = decideWindowOpen({
    url: 'https://destination.example/page', features: '', disposition: 'foreground-tab', referrer
  }, 'persist:test-browser')
  assert.equal(decision.kind, 'tab')
  assert.equal(decision.response.action, 'deny')
  if (decision.kind === 'tab') {
    assert.equal(decision.tab.url, 'https://destination.example/page')
    assert.equal(decision.tab.activate, true)
    assert.deepEqual(decision.tab.options, { httpReferrer: referrer })
  }
})

test('background dispositions create parked CodeApp tabs and preserve form POST data', () => {
  const data = [{ type: 'rawData' as const, bytes: Buffer.from('probe=popup-tab') }]
  const decision = decideWindowOpen({
    url: 'https://destination.example/form', features: '', disposition: 'background-tab', referrer,
    postBody: { contentType: 'application/x-www-form-urlencoded', data }
  }, 'persist:test-browser')
  assert.equal(decision.kind, 'tab')
  if (decision.kind === 'tab') {
    assert.equal(decision.tab.activate, false)
    assert.deepEqual(decision.tab.options?.postData, data)
    assert.equal(decision.tab.options?.extraHeaders, 'Content-Type: application/x-www-form-urlencoded')
  }
})

test('OAuth, explicit utility windows, and blank retarget bridges stay native', () => {
  for (const details of [
    { url: 'https://accounts.example.com/oauth/authorize', features: '' },
    { url: 'https://destination.example/tool', features: 'popup,width=480,height=360' },
    { url: 'about:blank', features: '' }
  ]) {
    const decision = decideWindowOpen({ ...details, disposition: 'new-window', referrer }, 'persist:test-browser')
    assert.equal(decision.kind, 'native-child')
    assert.equal(decision.response.action, 'allow')
    assert.equal(decision.response.outlivesOpener, false)
    assert.deepEqual(decision.response.overrideBrowserWindowOptions?.webPreferences, {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:test-browser',
      backgroundThrottling: true
    })
  }
})
