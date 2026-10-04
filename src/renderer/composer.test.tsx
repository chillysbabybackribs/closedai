import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Composer, type ComposerProps } from './composer.tsx'
import { resetAllComposerDrafts, setComposerDraft } from './composer-drafts.ts'

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

test('the idle composer is one capsule row: tools, draft, setup chip, send', () => {
  const html = renderToStaticMarkup(createElement(Composer, { ...baseProps }))
  assert.match(html, /class="composer"/)
  assert.match(html, /data-ui="composer\.upload"/)
  assert.doesNotMatch(html, /data-ui="composer\.more"/)
  assert.match(html, /data-ui="composer\.input"/)
  assert.match(html, /data-ui="composer\.setup"/)
  assert.match(html, /data-ui="composer\.send"[^>]*disabled/)
  assert.doesNotMatch(html, /data-ui="composer\.stop"/)
  assert.doesNotMatch(html, /data-ui="composer\.resume"/)
  assert.match(html, /class="composer-setup-chip"/)
  assert.doesNotMatch(html, /composer-footer|composer-pills/)
})

test('the running composer swaps send for pause and keeps the setup chip in the capsule', () => {
  const html = renderToStaticMarkup(createElement(Composer, {
    ...baseProps,
    models: [gpt4o],
    running: true
  }))
  assert.match(html, /data-ui="composer\.stop"/)
  assert.doesNotMatch(html, /data-ui="composer\.send"/)
  assert.match(html, /aria-label="Stop Codex \(Esc\)"/)
  // No spinner or clock on the trigger: it still names the model and folder while a turn runs.
  assert.match(html, /composer-chip-model-name[^>]*>GPT-4o</)
  assert.doesNotMatch(html, /composer-chip-folder-name/)
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

test('the trigger names only the model, not the folder or context size', () => {
  const html = renderToStaticMarkup(createElement(Composer, {
    ...baseProps,
    models: [{ ...gpt4o, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }],
    selectedReasoningEffort: 'high',
    projectPath: '/home/dp/Desktop/closedai'
  }))
  assert.match(html, /composer-chip-model-name[^>]*>GPT-4o</)
  assert.doesNotMatch(html, /composer-chip-folder-name/)
  assert.doesNotMatch(html, /128K/)
  assert.doesNotMatch(html, /composer-chip-model-trigger[^>]*>[^<]*High/)
  assert.doesNotMatch(html, /data-ui="composer\.folder"/)
})

test('the composer omits the folder even when a project change is queued', () => {
  const html = renderToStaticMarkup(createElement(Composer, { ...baseProps, projectPending: true }))
  assert.doesNotMatch(html, /composer-chip-folder-name/)
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

test('the capsule is one row for an empty draft and expands once it holds a line break', () => {
  const idle = renderToStaticMarkup(createElement(Composer, { ...baseProps, paneId: 'pane-idle' }))
  assert.doesNotMatch(idle, /data-expanded/)
  setComposerDraft('pane-multi', { input: 'first line\nsecond line', attachments: [] })
  const multi = renderToStaticMarkup(createElement(Composer, { ...baseProps, paneId: 'pane-multi' }))
  assert.match(multi, /class="[^"]*composer-stack[^"]*"[^>]*data-expanded="true"/)
  resetAllComposerDrafts()
})
