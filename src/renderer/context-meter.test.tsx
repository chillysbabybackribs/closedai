import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ContextMeter } from './context-meter.tsx'

test('ContextMeter renders children as hover trigger and omits standalone button', () => {
  const html = renderToStaticMarkup(createElement(ContextMeter, {
    usage: null,
    provider: 'antigravity',
    planUsage: null,
    modelName: 'Gemini 3.8 Flash',
    modelContext: '1M',
    onRefreshPlanUsage: async () => {},
    children: createElement('span', { className: 'selected-model' }, 'Gemini 3.8 Flash')
  }))
  assert.match(html, /class="selected-model"/)
  assert.match(html, /Gemini 3\.8 Flash/)
  assert.doesNotMatch(html, /class="context-meter"/)
})

test('ContextMeter fallback renders standalone button when children omitted', () => {
  const html = renderToStaticMarkup(createElement(ContextMeter, {
    usage: { usedTokens: 50_000, contextWindow: 1_000_000, percent: 5 },
    provider: 'antigravity',
    planUsage: null,
    onRefreshPlanUsage: async () => {}
  }))
  assert.match(html, /class="context-meter"/)
  assert.match(html, /data-ui="composer\.context"/)
  assert.match(html, /5%/)
})
