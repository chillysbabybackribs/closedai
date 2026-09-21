import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { WebPermissionRequest } from '../shared/security.ts'
import { WebPermissionBar, permissionDescription } from './web-permission-bar.tsx'

const noop = () => {}

function request(overrides: Partial<WebPermissionRequest> = {}): WebPermissionRequest {
  return { id: 'perm-1', tabId: 'tab-1', origin: 'https://meet.example', permission: 'media', requestedAt: 10, ...overrides }
}

test('each permission kind reads as what the page would get', () => {
  assert.equal(permissionDescription('media'), 'camera and microphone')
  assert.equal(permissionDescription('display-capture'), 'screen')
  assert.equal(permissionDescription('geolocation'), 'location')
  assert.equal(permissionDescription('notifications'), 'notifications')
})

test('the bar names the origin and the permission with Allow and Block keyed by request id', () => {
  const html = renderToStaticMarkup(createElement(WebPermissionBar, { requests: [request()], onDecide: noop }))
  assert.match(html, /role="region"[^>]*aria-live="polite"/)
  assert.match(html, /<strong>https:\/\/meet\.example<\/strong> wants to use your camera and microphone/)
  assert.match(html, /data-ui="browser\.permission-allow" data-ui-key="perm-1"[^>]*>Allow</)
  assert.match(html, /data-ui="browser\.permission-block" data-ui-key="perm-1"[^>]*>Block</)
})

test('the origin is text, never markup', () => {
  const html = renderToStaticMarkup(createElement(WebPermissionBar, {
    requests: [request({ origin: '<b>evil</b>' })], onDecide: noop
  }))
  assert.doesNotMatch(html, /<b>evil/)
  assert.match(html, /&lt;b&gt;evil&lt;\/b&gt;/)
})

test('requests stack oldest first and an empty list renders nothing', () => {
  assert.equal(renderToStaticMarkup(createElement(WebPermissionBar, { requests: [], onDecide: noop })), '')
  const html = renderToStaticMarkup(createElement(WebPermissionBar, {
    requests: [request({ id: 'later', requestedAt: 20, permission: 'geolocation' }), request({ id: 'earlier', requestedAt: 5 })],
    onDecide: noop
  }))
  assert.ok(html.indexOf('data-request-id="earlier"') < html.indexOf('data-request-id="later"'))
  assert.match(html, /wants to use your location/)
})
