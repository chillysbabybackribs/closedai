import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Composer, type ComposerProps } from './composer.tsx'
import { resetComposerLayoutCache, setComposerLayout } from './composer-layout.ts'

const baseProps: ComposerProps = {
  enabled: true,
  running: false,
  models: [],
  selectedModel: 'gpt-4o',
  selectedReasoningEffort: null,
  contextUsage: null,
  provider: 'codex',
  planUsage: null,
  onRefreshPlanUsage: async () => {},
  onModelChange: async () => {},
  onReasoningEffortChange: async () => {},
  onSend: async () => {},
  onStop: async () => {},
  paused: false,
  onResume: async () => {},
  onInspectContext: () => {},
  cwd: '/workspace',
  projectPath: '/workspace',
  recentProjects: [],
  onChooseProject: async () => {},
  onSelectProject: async () => {},
  onClearProject: async () => {},
  activeTurnId: null
}

test('idle composer defaults to full mode with collapse toggle', () => {
  const html = renderToStaticMarkup(createElement(Composer, { ...baseProps }))
  assert.doesNotMatch(html, /prompt-composer is-compact/)
  assert.match(html, /data-ui="composer\.compact-toggle"/)
  assert.match(html, /aria-label="Collapse composer"/)
  assert.match(html, /data-ui="composer\.input"/)
})

test('running composer stays full with stop and manual collapse controls', () => {
  const html = renderToStaticMarkup(createElement(Composer, {
    ...baseProps,
    running: true,
    activeTurnId: 'turn-123'
  }))
  assert.doesNotMatch(html, /prompt-composer is-compact/)
  assert.doesNotMatch(html, /prompt-composer-compact-row/)
  assert.match(html, /data-ui="composer\.stop"/)
  assert.match(html, /data-ui="composer\.compact-toggle"/)
  assert.match(html, /aria-label="Collapse composer"/)
  assert.match(html, /data-ui="composer\.input"/)
})

test('paused composer defaults to full mode with resume control', () => {
  const html = renderToStaticMarkup(createElement(Composer, {
    ...baseProps,
    paused: true
  }))
  assert.doesNotMatch(html, /prompt-composer is-compact/)
  assert.match(html, /data-ui="composer\.compact-toggle"/)
  assert.match(html, /aria-label="Collapse composer"/)
  assert.match(html, /data-ui="composer\.resume"/)
})

test('composer shows model name on the trigger and context meter below the card', () => {
  const html = renderToStaticMarkup(createElement(Composer, {
    ...baseProps,
    models: [
      {
        id: 'gpt-4o',
        displayName: 'GPT-4o',
        provider: 'codex',
        contextWindow: 128_000,
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: [],
        isDefault: true,
        description: 'Omni model'
      }
    ],
    selectedModel: 'gpt-4o'
  }))
  assert.match(html, /data-ui="composer\.model"/)
  assert.match(html, /model-menu-trigger-model/)
  assert.match(html, /GPT-4o/)
  // Context info (128K) is hidden from the resting trigger text
  assert.doesNotMatch(html, /model-menu-trigger-context/)
  assert.match(html, /class="context-meter"/)
  assert.match(html, /prompt-composer-context/)
})

test('a persisted compact choice renders the pill for a fresh composer', () => {
  setComposerLayout('compact')
  try {
    const html = renderToStaticMarkup(createElement(Composer, { ...baseProps }))
    assert.match(html, /prompt-composer is-compact/)
    assert.match(html, /prompt-composer-compact-row/)
    assert.match(html, /aria-label="Expand composer"/)
    // The project rail stays visible above the pill.
    assert.match(html, /data-ui="composer\.project"/)
  } finally {
    setComposerLayout('full')
    resetComposerLayoutCache()
  }
})

test('composer copy names the pane provider, not Codex', () => {
  const claude = renderToStaticMarkup(createElement(Composer, { ...baseProps, provider: 'claude', enabled: false }))
  assert.match(claude, /aria-label="Message Claude Code"/)
  assert.match(claude, /placeholder="Claude Code is unavailable"/)
  assert.doesNotMatch(claude, /Codex/)
  setComposerLayout('compact')
  const cursor = renderToStaticMarkup(createElement(Composer, { ...baseProps, provider: 'cursor' }))
  assert.match(cursor, /aria-label="Message Cursor"/)
  resetComposerLayoutCache()
})
