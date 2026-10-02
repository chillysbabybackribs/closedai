import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkspacePaneActionsContext } from './chat-layout/workspace-pane-actions.tsx'
import { ComposerWorkspaceTools, type ComposerWorkspaceToolsProps } from './composer-workspace-tools.tsx'

const actions = {
  toggleBrowser: () => {},
  openFile: async () => {},
  newChat: () => {},
  openAgentsView: () => {},
  focusChatTab: async () => {},
  startAgentFromPane: async () => {},
  agentsMenuPaneId: null,
  setAgentsMenuPaneId: () => {}
}

const base: ComposerWorkspaceToolsProps = { paneId: 'pane-a', startEnabled: true, runningTurn: false, onComposerError: () => {} }

function render(props: Partial<ComposerWorkspaceToolsProps> = {}): string {
  return renderToStaticMarkup(createElement(WorkspacePaneActionsContext.Provider, { value: actions },
    createElement(ComposerWorkspaceTools, { ...base, ...props })))
}

test('the capsule tools offer agents, and leave new chat and browser to the header and dock', () => {
  const html = render()
  assert.match(html, /data-ui="composer\.agents" data-ui-key="pane-a"/)
  assert.doesNotMatch(html, /composer\.browser|composer\.new-chat/)
  assert.doesNotMatch(html, /composer\.continue/)
})

test('fresh context is an icon until the window is half full, then it names itself', () => {
  const handoff = { continueMessageId: 'item-1', onContinueInNewChat: async () => {} }
  const quiet = render({ ...handoff, contextPercent: 20 })
  assert.match(quiet, /data-ui="composer\.continue"/)
  assert.doesNotMatch(quiet, /composer-chip-label/)
  const loud = render({ ...handoff, contextPercent: 64 })
  assert.match(loud, /composer-chip-label[^>]*>Fresh context</)
})

test('the capsule tools stay hidden without workspace context', () => {
  assert.equal(renderToStaticMarkup(createElement(ComposerWorkspaceTools, base)), '')
})
