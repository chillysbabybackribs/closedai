import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import { chatLayoutRevision } from './layout-revision.js'

function snapshot(over: Partial<ChatWorkspaceSnapshot> & Pick<ChatWorkspaceSnapshot, 'selectedPaneId'>): ChatWorkspaceSnapshot {
  return {
    chats: [],
    selected: { cwd: '/w', items: [], threadId: null } as unknown as ChatWorkspaceSnapshot['selected'],
    workspace: { cwd: '/w', projectPath: '/w' },
    preferences: { chatSeamlessRotation: false },
    ...over
  } as ChatWorkspaceSnapshot
}

test('chatLayoutRevision ignores preview-only chat row changes', () => {
  const base = snapshot({
    selectedPaneId: 'pane-a',
    chats: [{ paneId: 'pane-a', updatedAt: 1, preview: 'hello' } as ChatWorkspaceSnapshot['chats'][number]]
  })
  const previewBump = snapshot({
    selectedPaneId: 'pane-a',
    chats: [{ paneId: 'pane-a', updatedAt: 1, preview: 'hello world' } as ChatWorkspaceSnapshot['chats'][number]]
  })
  assert.equal(chatLayoutRevision(base), chatLayoutRevision(previewBump))
})

test('chatLayoutRevision changes when pane membership or selection changes', () => {
  const one = snapshot({ selectedPaneId: 'pane-a', chats: [{ paneId: 'pane-a' } as ChatWorkspaceSnapshot['chats'][number]] })
  const two = snapshot({
    selectedPaneId: 'pane-a',
    chats: [
      { paneId: 'pane-a' } as ChatWorkspaceSnapshot['chats'][number],
      { paneId: 'pane-b' } as ChatWorkspaceSnapshot['chats'][number]
    ]
  })
  const switched = snapshot({ selectedPaneId: 'pane-b', chats: two.chats })
  assert.notEqual(chatLayoutRevision(one), chatLayoutRevision(two))
  assert.notEqual(chatLayoutRevision(two), chatLayoutRevision(switched))
})
