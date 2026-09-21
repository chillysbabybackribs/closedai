import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { CredentialApprovalRequest } from '../shared/security.ts'
import { CredentialApprovalCard, CredentialApprovalCards } from './credential-approval-card.tsx'

const noop = () => {}

function request(overrides: Partial<CredentialApprovalRequest> = {}): CredentialApprovalRequest {
  return { id: 'req-1', paneId: 'pane-1', credentialId: 'cred-1', credentialLabel: 'GitHub deploy key',
    serviceName: 'github.com', fieldIds: ['token', 'username'], reason: 'push the release branch',
    requestedAt: 10, ...overrides }
}

test('the card names the credential, its fields, the reason, and both answers keyed by request id', () => {
  const html = renderToStaticMarkup(createElement(CredentialApprovalCard, { request: request(), onDecide: noop }))
  assert.match(html, /role="region"[^>]*aria-live="polite"[^>]*aria-labelledby="credential-approval-req-1"/)
  assert.match(html, /<h3 id="credential-approval-req-1"[^>]*>Agent wants to use a credential<\/h3>/)
  assert.match(html, /<strong>GitHub deploy key<\/strong>/)
  assert.match(html, /github\.com/)
  assert.match(html, /<li>token<\/li><li>username<\/li>/)
  assert.match(html, /“push the release branch”/)
  assert.match(html, /data-ui="chat\.credential-allow" data-ui-key="req-1"[^>]*>Allow</)
  assert.match(html, /data-ui="chat\.credential-deny" data-ui-key="req-1"[^>]*>Deny</)
})

test('the agent’s reason is text, never markup', () => {
  const html = renderToStaticMarkup(createElement(CredentialApprovalCard, {
    request: request({ reason: '<img src=x onerror=alert(1)> need it' }), onDecide: noop
  }))
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; need it/)
  const silent = renderToStaticMarkup(createElement(CredentialApprovalCard, { request: request({ reason: '' }), onDecide: noop }))
  assert.doesNotMatch(silent, /chat-approval-reason/)
})

test('pending requests stack oldest first and an empty list renders nothing', () => {
  assert.equal(renderToStaticMarkup(createElement(CredentialApprovalCards, { requests: [], onDecide: noop })), '')
  const html = renderToStaticMarkup(createElement(CredentialApprovalCards, {
    requests: [request({ id: 'later', requestedAt: 20 }), request({ id: 'earlier', requestedAt: 5 })], onDecide: noop
  }))
  assert.match(html, /class="chat-approval-stack"/)
  assert.ok(html.indexOf('data-request-id="earlier"') < html.indexOf('data-request-id="later"'))
})
