import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { TooltipProvider } from '../components/ui/tooltip.js'
import type { ChatAttachment } from '../shared/chat.js'
import { ComposerCompactRow } from './composer-compact-row.tsx'
import {
  clearComposerDraft,
  getComposerDraft,
  resetAllComposerDrafts,
  setComposerDraft
} from './composer-drafts.ts'

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

test('ComposerCompactRow renders the pill input and expand control', () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ComposerCompactRow, {
        running: false,
        provider: 'codex',
        placeholder: 'Ask anything',
        enabled: true,
        sending: false,
        paused: false,
        canSend: true,
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
  assert.match(html, /data-ui="composer\.compact-toggle"/)
})
