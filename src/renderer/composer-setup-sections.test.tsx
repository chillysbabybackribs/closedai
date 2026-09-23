import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ChatModel } from '../shared/chat.js'
import { EffortSection, FolderSection, folderName, ModelSection } from './composer-setup-sections.tsx'
import { providerSections } from './model-menu-state.ts'

function model(id: string, provider: ChatModel['provider'], displayName = id): ChatModel {
  return { id, provider, displayName, description: '', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [], isDefault: false }
}

test('the model section groups by provider, checks the selection, and folds long catalogues', () => {
  const models = [
    model('gpt-5', 'codex', 'GPT-5'),
    ...Array.from({ length: 8 }, (_, index) => model(`cursor-${index}`, 'cursor', `Cursor ${index}`))
  ]
  const html = renderToStaticMarkup(createElement(ModelSection, {
    sections: providerSections(models, {}, 'gpt-5'),
    selectedModel: 'gpt-5',
    disabled: false,
    onChoose: () => {}
  }))
  assert.match(html, /data-ui="composer\.model-item" data-ui-key="gpt-5"[^>]*/)
  assert.match(html, /role="radio" aria-checked="true"[^>]*data-ui-key="gpt-5"/)
  assert.match(html, /data-ui="composer\.model-more" data-ui-key="cursor"[^>]*>[\s\S]*Show 4 more models/)
  assert.doesNotMatch(html, /Cursor 7/)
})

test('the model section says so when there are no models', () => {
  const html = renderToStaticMarkup(createElement(ModelSection, { sections: [], selectedModel: null, disabled: false, onChoose: () => {} }))
  assert.match(html, /No models are available yet/)
})

test('effort is a segmented radio group with the current level checked', () => {
  const html = renderToStaticMarkup(createElement(EffortSection, {
    efforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'high', description: 'Thorough' }],
    selected: 'high',
    disabled: true,
    onChoose: () => {}
  }))
  assert.match(html, /composer-setup-segment/)
  assert.match(html, /aria-checked="false"[^>]*data-ui-key="low"[^>]*disabled/)
  assert.match(html, /aria-checked="true"[^>]*data-ui-key="high"/)
  assert.match(html, />Low<|>High</)
})

test('the folder section lists the current folder, the other recents, and both ways to change', () => {
  const html = renderToStaticMarkup(createElement(FolderSection, {
    cwd: '/home/dp/Desktop/closedai',
    projectPath: '/home/dp/Desktop/closedai',
    pending: false,
    recentProjects: [
      { cwd: '/home/dp/Desktop/closedai', projectPath: '/home/dp/Desktop/closedai' },
      { cwd: '/home/dp/firecracker', projectPath: '/home/dp/firecracker' }
    ],
    disabled: false,
    onChooseProject: async () => {},
    onSelectProject: async () => {},
    onClearProject: async () => {},
    onError: () => {}
  }))
  assert.match(html, /is-current[^>]*>[\s\S]*?closedai/)
  assert.match(html, /data-ui="composer\.project-recent" data-ui-key="\/home\/dp\/firecracker"/)
  assert.doesNotMatch(html, /data-ui="composer\.project-recent" data-ui-key="\/home\/dp\/Desktop\/closedai"/)
  assert.match(html, /data-ui="composer\.project-new"/)
  assert.match(html, /data-ui="composer\.project-clear"/)
  assert.equal(folderName('/a/b/c/'), 'c')
  assert.equal(folderName(''), 'Workspace')
})

test('without a project the clear action is disabled and the row says so', () => {
  const html = renderToStaticMarkup(createElement(FolderSection, {
    cwd: '/home/dp',
    projectPath: null,
    pending: true,
    recentProjects: [],
    disabled: false,
    onChooseProject: async () => {},
    onSelectProject: async () => {},
    onClearProject: async () => {},
    onError: () => {}
  }))
  assert.match(html, /No project/)
  assert.match(html, /change queued/)
  assert.match(html, /data-ui="composer\.project-clear"[^>]*disabled/)
})
