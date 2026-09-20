import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { TooltipProvider } from '../components/ui/tooltip.js'
import type { ChatAttachment } from '../shared/chat.js'
import { ComposerCompactRow } from './composer-compact-row.tsx'
import {
  clearComposerDraft,
  estimateDraftTokens,
  getComposerDraft,
  getDraftTokenStatus,
  resetAllComposerDrafts,
  setComposerDraft
} from './composer-drafts.ts'
import { ComposerTokenBadge } from './composer-token-badge.tsx'

test('composer draft store preserves drafts independently per paneId', () => {
  resetAllComposerDrafts()

  // Initially empty
  assert.deepEqual(getComposerDraft('pane-1'), { input: '', attachments: [] })
  assert.deepEqual(getComposerDraft('pane-2'), { input: '', attachments: [] })

  // Set draft for pane 1
  setComposerDraft('pane-1', {
    input: 'Draft prompt for agent 1',
    attachments: []
  })

  // Set draft for pane 2 with attachments
  const sampleAttachment: ChatAttachment = {
    id: 'att-1',
    kind: 'file',
    name: 'test.ts',
    path: '/workspace/test.ts'
  }
  setComposerDraft('pane-2', {
    input: 'Draft for agent 2',
    attachments: [sampleAttachment]
  })

  // Verify pane 1 draft is preserved
  const draft1 = getComposerDraft('pane-1')
  assert.equal(draft1.input, 'Draft prompt for agent 1')
  assert.equal(draft1.attachments.length, 0)

  // Verify pane 2 draft is preserved
  const draft2 = getComposerDraft('pane-2')
  assert.equal(draft2.input, 'Draft for agent 2')
  assert.equal(draft2.attachments.length, 1)
  assert.equal(draft2.attachments[0]?.name, 'test.ts')

  // Clear draft for pane 1
  clearComposerDraft('pane-1')
  assert.deepEqual(getComposerDraft('pane-1'), { input: '', attachments: [] })

  // Pane 2 remains intact
  assert.equal(getComposerDraft('pane-2').input, 'Draft for agent 2')
})

test('estimateDraftTokens calculates text and attachment token costs', () => {
  assert.equal(estimateDraftTokens(''), 0)
  assert.equal(estimateDraftTokens('abcd'), 1)
  assert.equal(estimateDraftTokens('abcdefgh'), 2)
  assert.equal(estimateDraftTokens('a'.repeat(400)), 100)

  // With attachments
  const fileAtt: ChatAttachment = { id: '1', kind: 'file', name: 'main.ts', path: '/a/main.ts' }
  const imgAtt: ChatAttachment = { id: '2', kind: 'image', name: 'ui.png', source: { type: 'path', path: '/a/ui.png' } }

  const textTokens = estimateDraftTokens('Hello world', [fileAtt])
  // 11 chars = 3 tokens + 250 for file = 253
  assert.equal(textTokens, 253)

  const imageTokens = estimateDraftTokens('', [imgAtt])
  assert.equal(imageTokens, 1000)
})

test('getDraftTokenStatus categorizes normal, warn, and critical draft sizes', () => {
  // Normal
  const normal = getDraftTokenStatus(500)
  assert.equal(normal.level, 'normal')
  assert.equal(normal.label, '≈500 tokens')

  // Warn (>= 10k tokens)
  const warn = getDraftTokenStatus(12000)
  assert.equal(warn.level, 'warn')
  assert.match(warn.label, /Large prompt/)

  // Critical (>= 25k tokens)
  const critical = getDraftTokenStatus(30000)
  assert.equal(critical.level, 'critical')
  assert.match(critical.label, /Very large/)

  // Critical due to exceeding available context headroom
  const exceeds = getDraftTokenStatus(8000, 100000, 95000)
  // headroom is 5000, draft is 8000
  assert.equal(exceeds.level, 'critical')
  assert.match(exceeds.label, /Exceeds context/)
})

test('ComposerTokenBadge renders null when no draft text or attachments exist', () => {
  const html = renderToStaticMarkup(
    createElement(ComposerTokenBadge, {
      input: '',
      attachments: []
    })
  )
  assert.equal(html, '')
})

test('ComposerTokenBadge renders normal badge when draft is active', () => {
  const html = renderToStaticMarkup(
    createElement(ComposerTokenBadge, {
      input: 'Please summarize this function.',
      attachments: []
    })
  )
  assert.match(html, /composer-token-badge-normal/)
  assert.match(html, /data-level="normal"/)
  assert.match(html, /≈8 tokens/)
})

test('ComposerTokenBadge renders warning and critical indicators for large drafts', () => {
  const warnHtml = renderToStaticMarkup(
    createElement(ComposerTokenBadge, {
      input: 'x'.repeat(45000), // ~11,250 tokens
      attachments: []
    })
  )
  assert.match(warnHtml, /composer-token-badge-warn/)
  assert.match(warnHtml, /Large prompt/)

  const critHtml = renderToStaticMarkup(
    createElement(ComposerTokenBadge, {
      input: 'x'.repeat(120000), // ~30,000 tokens
      attachments: []
    })
  )
  assert.match(critHtml, /composer-token-badge-critical/)
  assert.match(critHtml, /Very large/)
})

test('ComposerCompactRow renders compact model and controls', () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ComposerCompactRow, {
        running: false,
        activeTurnId: null,
        selectedModel: 'gpt-4o',
        provider: 'codex',
        placeholder: 'Ask anything',
        enabled: true,
        sending: false,
        paused: false,
        canSend: true,
        waitingForInput: false,
        onPaste: () => {},
        onFocus: () => {},
        onBlur: () => {},
        onStop: async () => {},
        onResume: async () => {},
        onExpand: () => {}
      })
    )
  )

  assert.match(html, /prompt-composer-compact-row/)
  assert.match(html, /data-ui="composer\.input"/)
  assert.match(html, /data-ui="composer\.send"/)
  assert.match(html, /data-ui="composer\.compact-toggle"/)
  assert.match(html, /gpt-4o/)
})
