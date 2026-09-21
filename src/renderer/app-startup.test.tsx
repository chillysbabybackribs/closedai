import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppStartup } from './app-startup.tsx'

test('before the first snapshot the shell says it is starting', () => {
  const html = renderToStaticMarkup(createElement(AppStartup, {
    connection: { state: 'starting', message: 'Starting…' }, onRetry: () => {}
  }))
  assert.match(html, /role="status"/)
  assert.match(html, /Starting ClosedAI…/)
  assert.doesNotMatch(html, /Retry/)
})

test('a failed snapshot names the reason and offers Retry', () => {
  const html = renderToStaticMarkup(createElement(AppStartup, {
    connection: { state: 'error', message: 'The chat service did not answer' }, onRetry: () => {}
  }))
  assert.match(html, /role="alert"/)
  assert.match(html, /Could not start/)
  assert.match(html, /The chat service did not answer/)
  assert.match(html, />Retry</)
})
