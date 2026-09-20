import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Composer, type ComposerProps } from './composer.tsx'

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
