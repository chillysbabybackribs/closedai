import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ageNote, contextLevel, ContextUsage, resetNote } from './context-meter.tsx'

test('ContextUsage names the model and shows a dash until the first reading', () => {
  const html = renderToStaticMarkup(createElement(ContextUsage, {
    usage: null,
    provider: 'antigravity',
    planUsage: null,
    modelName: 'Gemini 3.8 Flash',
    modelContext: '1M'
  }))
  assert.match(html, /data-ui="composer\.usage"/)
  assert.match(html, /Gemini 3\.8 Flash · 1M/)
  assert.match(html, /usage-row-aside[^>]*>—\/1M</)
  assert.match(html, /data-level="cool"/)
  assert.doesNotMatch(html, /composer\.compact/)
})

test('ContextUsage reports tokens, colours the level, and offers compaction when the provider can', () => {
  const html = renderToStaticMarkup(createElement(ContextUsage, {
    usage: { usedTokens: 800_000, contextWindow: 1_000_000, percent: 80 },
    provider: 'codex',
    planUsage: { plan: 'Pro', note: null, unavailable: null, updatedAt: Date.now(), windows: [{ label: '5h', percent: 12, resetsAt: Date.now() + 90 * 60_000 }] },
    onCompact: async () => {},
    compactEnabled: true
  }))
  assert.match(html, /data-level="hot"/)
  assert.match(html, /800k\/1000k/)
  assert.match(html, /· Pro/)
  assert.match(html, /12% · 2h/)
  assert.match(html, /data-ui="composer\.compact"/)
})

test('levels and notes', () => {
  assert.equal(contextLevel(10), 'cool')
  assert.equal(contextLevel(50), 'warm')
  assert.equal(contextLevel(75), 'hot')
  assert.equal(resetNote(0, 1), 'resetting')
  assert.equal(resetNote(10 * 60_000, 0), '10m')
  assert.equal(ageNote(3 * 60 * 60_000), '3h ago')
})
