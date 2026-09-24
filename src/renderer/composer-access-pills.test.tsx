import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkspacePaneActionsContext } from './chat-layout/workspace-pane-actions.tsx'
import { ComposerAccessPills } from './composer-access-pills.tsx'

test('composer access pills render browser and agents controls when workspace actions exist', () => {
  const html = renderToStaticMarkup(createElement(WorkspacePaneActionsContext.Provider, {
    value: {
      toggleBrowser: () => {},
      newChat: () => {},
      openAgentsView: () => {},
      focusChatTab: async () => {},
      startAgentFromPane: async () => {},
      agentsMenuPaneId: null,
      setAgentsMenuPaneId: () => {}
    }
  }, createElement(ComposerAccessPills, {
    paneId: 'pane-a',
    startEnabled: true,
    runningTurn: false,
    onComposerError: () => {}
  })))
  assert.match(html, /data-ui="composer\.browser"/)
  assert.match(html, /data-ui="composer\.new-chat" data-ui-key="pane-a"/)
  assert.match(html, /data-ui="composer\.agents"/)
})

test('composer access pills stay hidden without workspace context', () => {
  const html = renderToStaticMarkup(createElement(ComposerAccessPills, {
    paneId: 'pane-a',
    startEnabled: true,
    runningTurn: false,
    onComposerError: () => {}
  }))
  assert.equal(html, '')
})
