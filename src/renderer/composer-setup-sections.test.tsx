import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { EffortSection, FolderSection, folderName } from './composer-setup-sections.tsx'

test('effort is a segmented toggle group with the current level on', () => {
  const html = renderToStaticMarkup(createElement(EffortSection, {
    efforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'high', description: 'Thorough' }],
    selected: 'high',
    disabled: true,
    note: 'Locked while this turn runs',
    providerLabel: 'Codex',
    onChoose: () => {}
  }))
  assert.match(html, /data-state="off"[^>]*data-ui="composer\.effort-item" data-ui-key="low"/)
  assert.match(html, /data-state="on"[^>]*data-ui="composer\.effort-item" data-ui-key="high"/)
  assert.match(html, /Locked while this turn runs/)
  assert.match(html, />Low<[\s\S]*>High</)
})

test('a model without effort levels keeps the row and says who sets it', () => {
  const html = renderToStaticMarkup(createElement(EffortSection, {
    efforts: [], selected: null, disabled: false, providerLabel: 'Cursor', onChoose: () => {}
  }))
  assert.match(html, /Set by Cursor for this model/)
  assert.doesNotMatch(html, /composer\.effort-item/)
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
  assert.match(html, /composer-folder-current[^>]*>[\s\S]*?closedai/)
  assert.match(html, /composer-folder-chip[^>]*data-ui-key="\/home\/dp\/firecracker"/)
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
  assert.match(html, /queued until idle/)
  assert.match(html, /data-ui="composer\.project-clear"[^>]*disabled/)
})
