import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContinuationCard } from './continuation-card.tsx'

const source = { paneId: 'pane-a', title: 'Parser <work>', handoff: 'Handoff from the previous chat "Parser work".' }

test('the card names its source and offers to open it and to show the digest', () => {
  const html = renderToStaticMarkup(createElement(ContinuationCard, { source, canOpenSource: true, onOpenSource: () => {} }))
  assert.match(html, /Continuing from “Parser &lt;work&gt;”/)
  assert.match(html, /what was asked, what was\s+concluded, which files changed, and where it stood/)
  assert.match(html, /data-ui="chat\.continuation-source"[^>]*>Open previous chat/)
  assert.match(html, /data-ui="chat\.continuation-digest"[^>]*aria-expanded="false"/)
  assert.match(html, /Show what the new chat receives/)
  // Collapsed by default: the digest is model-facing text the user can inspect, not the pane's content.
  assert.doesNotMatch(html, /<pre/)
})

test('a source that no longer exists leaves only the title and digest', () => {
  const html = renderToStaticMarkup(createElement(ContinuationCard, { source, canOpenSource: false, onOpenSource: () => {} }))
  assert.doesNotMatch(html, /chat\.continuation-source/)
  assert.match(html, /chat\.continuation-digest/)
})

test('a delivered digest has nothing left to show', () => {
  const html = renderToStaticMarkup(createElement(ContinuationCard, {
    source: { ...source, handoff: null }, canOpenSource: true, onOpenSource: () => {}
  }))
  assert.match(html, /chat\.continuation-source/)
  assert.doesNotMatch(html, /chat\.continuation-digest/)
})
