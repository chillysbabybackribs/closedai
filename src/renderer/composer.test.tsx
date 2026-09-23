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
  cwd: '/workspace',
  projectPath: '/workspace',
  recentProjects: [],
  onChooseProject: async () => {},
  onSelectProject: async () => {},
  onClearProject: async () => {}
}

const gpt4o: ComposerProps['models'][number] = {
  id: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'codex',
  contextWindow: 128_000,
  defaultReasoningEffort: 'low',
  supportedReasoningEfforts: [],
  isDefault: true,
  description: 'Omni model'
}

test('the idle composer has a message card and setup metadata beneath it', () => {
  const html = renderToStaticMarkup(createElement(Composer, { ...baseProps }))
  assert.match(html, /class="composer"/)
  assert.match(html, /data-ui="composer\.upload"/)
  assert.match(html, /data-ui="composer\.input"/)
  assert.match(html, /data-ui="composer\.setup"/)
  assert.match(html, /data-ui="composer\.send"[^>]*disabled/)
  assert.doesNotMatch(html, /data-ui="composer\.stop"/)
  assert.doesNotMatch(html, /data-ui="composer\.resume"/)
  assert.match(html, /class="composer-footer"/)
})

test('the running composer swaps send for pause and keeps setup metadata beneath the card', () => {
  const html = renderToStaticMarkup(createElement(Composer, {
    ...baseProps,
    models: [gpt4o],
    running: true
  }))
  assert.match(html, /data-ui="composer\.stop"/)
  assert.doesNotMatch(html, /data-ui="composer\.send"/)
  assert.match(html, /aria-label="Pause Codex \(Esc\)"/)
  // No spinner or clock on the trigger: it still names the model and folder while a turn runs.
  assert.match(html, /composer-footer-model-name[^>]*>GPT-4o</)
  assert.match(html, /composer-footer-folder-name[^>]*>workspace</)
  assert.doesNotMatch(html, /composer-setup-mark/)
  assert.doesNotMatch(html, /Working for|spinner|elapsed/)
  assert.match(html, /placeholder=""/)
})

test('the paused composer offers resume and says so in the placeholder', () => {
  const html = renderToStaticMarkup(createElement(Composer, { ...baseProps, paused: true }))
  assert.match(html, /data-ui="composer\.resume"/)
  assert.doesNotMatch(html, /data-ui="composer\.send"/)
  assert.match(html, /placeholder="Resume, or send something new"/)
})

test('the trigger names the model and folder, not the context size or effort', () => {
  const html = renderToStaticMarkup(createElement(Composer, {
    ...baseProps,
    models: [{ ...gpt4o, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }],
    selectedReasoningEffort: 'high',
    projectPath: '/home/dp/Desktop/closedai'
  }))
  assert.match(html, /composer-footer-model-name[^>]*>GPT-4o</)
  assert.match(html, /composer-footer-folder-name[^>]*>closedai</)
  assert.doesNotMatch(html, /128K/)
  assert.doesNotMatch(html, /composer-footer-trigger[^>]*>[^<]*High/)
})

test('a queued folder change is named on the trigger', () => {
  const html = renderToStaticMarkup(createElement(Composer, { ...baseProps, projectPending: true }))
  assert.match(html, /composer-footer-folder-name[^>]*>workspace \(queued\)</)
})

test('composer copy names the pane provider, not Codex', () => {
  const claude = renderToStaticMarkup(createElement(Composer, { ...baseProps, provider: 'claude', enabled: false }))
  assert.match(claude, /aria-label="Message Claude Code"/)
  assert.match(claude, /placeholder="Claude Code is unavailable"/)
  assert.doesNotMatch(claude, /Codex/)
  const cursor = renderToStaticMarkup(createElement(Composer, { ...baseProps, provider: 'cursor' }))
  assert.match(cursor, /placeholder="Message Cursor"/)
  assert.match(cursor, /aria-label="Send to Cursor \(Enter\)"/)
})
