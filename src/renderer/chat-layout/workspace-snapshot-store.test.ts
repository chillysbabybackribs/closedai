import assert from 'node:assert/strict'
import test from 'node:test'
import { initialChatState } from '../chat-state.js'
import {
  getWorkspaceSnapshot,
  paneChatSnapshot,
  setWorkspaceSnapshot,
  workspacePaneSlice,
  workspacePaneSliceEqual
} from './workspace-snapshot-store.js'

test('paneChatSnapshot reads mounted panes and selected fallback', () => {
  const pane = initialChatState()
  pane.threadId = 'thread-a'
  setWorkspaceSnapshot({
    selectedPaneId: 'pane-a',
    chats: [],
    selected: { ...initialChatState(), threadId: 'selected-only' },
    panes: { 'pane-a': pane }
  })
  assert.equal(paneChatSnapshot(getWorkspaceSnapshot(), 'pane-a')?.threadId, 'thread-a')
  assert.equal(paneChatSnapshot(getWorkspaceSnapshot(), 'pane-b')?.threadId, undefined)
})

test('workspacePaneSliceEqual ignores unrelated pane updates', () => {
  const left = workspacePaneSlice(getWorkspaceSnapshot(), 'pane-a')
  const paneB = initialChatState()
  paneB.threadId = 'other'
  const current = getWorkspaceSnapshot()
  setWorkspaceSnapshot({
    ...current,
    panes: { ...current.panes, 'pane-b': paneB }
  })
  const right = workspacePaneSlice(getWorkspaceSnapshot(), 'pane-a')
  assert.equal(workspacePaneSliceEqual(left, right), true)
})
