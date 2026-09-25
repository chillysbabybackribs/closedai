import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ComposerContinuePill } from './composer-continue-pill.tsx'

test('the fresh context pill names the handoff and keeps the full phrase in the accessible label', () => {
  const html = renderToStaticMarkup(createElement(ComposerContinuePill, {
    messageId: 'item-1',
    runningTurn: false,
    labelled: true,
    onContinue: async () => {},
    onError: () => {}
  }))
  assert.match(html, /data-ui="composer\.continue" data-ui-key="item-1"/)
  assert.match(html, /Fresh context/)
  assert.match(html, /aria-label="Continue in new chat with fresh context"/)
  assert.match(html, /Continue this conversation in a new tab with a fresh context window/)
})

test('the fresh context pill is disabled while a turn runs', () => {
  const html = renderToStaticMarkup(createElement(ComposerContinuePill, {
    messageId: 'item-1',
    runningTurn: true,
    onContinue: async () => {},
    onError: () => {}
  }))
  assert.match(html, /data-ui="composer\.continue"[^>]*disabled/)
})
