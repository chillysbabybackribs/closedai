import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebContents, WebContentsViewConstructorOptions } from 'electron'
import { decideWindowOpen, type CreatePopupTab, type PopupTabRequest } from './browser-popup-policy.ts'

const referrer = { url: 'https://source.example/', policy: 'strict-origin-when-cross-origin' as const }

const child = { id: 42 } as WebContents
function host() {
  const calls: { options: WebContentsViewConstructorOptions; request: PopupTabRequest }[] = []
  const create: CreatePopupTab = (options, request) => { calls.push({ options, request }); return child }
  return { calls, create }
}

test('normal page-requested windows adopt Chromium contents into tabs', () => {
  const { calls, create } = host()
  const decision = decideWindowOpen({
    url: 'https://destination.example/page', features: '', disposition: 'foreground-tab', referrer
  }, 'persist:test-browser', create)
  assert.equal(decision.action, 'allow')
  const options = { webContents: child, webPreferences: { sandbox: true } }
  assert.equal(decision.createWindow!(options), child)
  assert.equal(calls[0].options, options)
  assert.equal(calls[0].options.webContents, child)
  assert.deepEqual(calls[0].request, {
    url: 'https://destination.example/page', activate: true, options: { httpReferrer: referrer }
  })
})

test('background dispositions create parked CodeApp tabs and preserve form POST data', () => {
  const data = [{ type: 'rawData' as const, bytes: Buffer.from('probe=popup-tab') }]
  const { calls, create } = host()
  const decision = decideWindowOpen({
    url: 'https://destination.example/form', features: '', disposition: 'background-tab', referrer,
    postBody: { contentType: 'application/x-www-form-urlencoded', data }
  }, 'persist:test-browser', create)
  decision.createWindow!({})
  assert.equal(calls[0].options.webContents, undefined)
  assert.equal(calls[0].request.activate, false)
  assert.deepEqual(calls[0].request.options?.postData, data)
  assert.equal(calls[0].request.options?.extraHeaders, 'Content-Type: application/x-www-form-urlencoded')
})

test('OAuth, sized utility windows and blank windows use the same secure tab host', () => {
  for (const details of [
    { url: 'https://accounts.example.com/oauth/authorize', features: '' },
    { url: 'https://destination.example/tool', features: 'popup,width=480,height=360' },
    { url: 'about:blank', features: '' }
  ]) {
    const { calls, create } = host()
    const decision = decideWindowOpen({ ...details, disposition: 'new-window', referrer }, 'persist:test-browser', create)
    assert.equal(decision.action, 'allow')
    assert.equal(decision.outlivesOpener, true)
    assert.deepEqual(decision.overrideBrowserWindowOptions?.webPreferences, {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:test-browser',
      backgroundThrottling: true,
      autoplayPolicy: 'document-user-activation-required',
      enableWebSQL: false,
      safeDialogs: true
    })
    decision.createWindow!({})
    assert.equal(calls[0].request.url, details.url)
    assert.equal(calls[0].request.activate, true)
  }
})

test('workers without a tab host deny even login and sized popups', () => {
  const decision = decideWindowOpen({
    url: 'https://accounts.example.com/login', features: 'width=400', disposition: 'new-window', referrer
  }, 'research-public')
  assert.deepEqual(decision, { action: 'deny' })
})
