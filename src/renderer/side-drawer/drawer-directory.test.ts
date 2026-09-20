import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatController } from '../chat-controller.js'
import { initialChatState } from '../chat-state.js'
import type { DrawerController } from './drawer-controller.js'
import { DrawerDirectory } from './drawer-directory.js'
import { buildDrawerRows } from './drawer-rows.js'
import { groupByDirectory } from './drawer-sections.js'

test('directory groups retain full-path identity, live counts, and independent history visibility', () => {
  const chats: ChatRowSummary[] = ['/a/task', '/b/task'].map((cwd, index) => ({
    paneId: `chat-${index}`, parentPaneId: null, kind: 'peer', provider: 'codex', modelId: null,
    threadId: `thread-${index}`, title: `Chat ${index}`, preview: '', cwd,
    attached: true, pinnedAt: null, running: index === 0, activity: null,
    createdAt: index, updatedAt: index, lastTurnEndedAt: null
  }))
  const state = { ...initialChatState(), cwd: '/b/task' }
  const rows = buildDrawerRows({ selected: state, selectedPaneId: 'chat-1', chats, selectedDiff: { added: 0, removed: 0 } })
  const groups = groupByDirectory(rows.reverse())
  assert.deepEqual(groups.map((group) => group.key), ['/a/task', '/b/task'])
  const chat = { state, selectedPaneId: 'chat-1', workspace: { cwd: '/b/task' } } as ChatController
  const controller = { reviewQueue: {} } as DrawerController
  const render = (index: number, collapsed: boolean, historyOpen = false) => renderToStaticMarkup(createElement(DrawerDirectory, {
    group: groups[index]!, collapsed, historyOpen, onToggle: () => {}, onToggleHistory: () => {}, controller, chat,
    fold: { collapsedParents: new Set(), expandedSettled: new Set(), onToggleParent: () => {}, onToggleSettled: () => {} },
    onRowMenu: () => {}
  }))
  const hidden = render(0, true)
  assert.match(hidden, /1 running/)
  assert.match(hidden, /data-ui-key="\/a\/task"/)
  assert.doesNotMatch(hidden, /data-ui="drawer.row"/)
  assert.match(render(0, false), /Chat 0/)
  assert.match(render(1, false), />Active</)
  assert.doesNotMatch(render(1, false), /data-ui="drawer.row"/)
  assert.match(render(1, false, true), /Chat 1/)
})
