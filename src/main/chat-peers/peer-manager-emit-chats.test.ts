import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { peerManagerEmitChats, type PeerManagerSupportHost } from './peer-manager-support.js'

const seed = { cwd: '/w', projectPath: '/w', provider: 'codex' as const, modelId: 'gpt', reasoningEffort: null }

test('peerManagerEmitChats skips redundant drawer updates', () => {
  const store = ChatStore.inMemory()
  const record = store.create({ ...seed, title: 'One', titleSource: 'generated', messageSentAt: 1 })
  const events: ChatWorkspaceEvent[] = []
  const host = {
    lifecycle: { ids: () => [], get: () => undefined },
    store,
    projectChanges: { selection: () => null },
    selectedPaneId: () => 'pane-a',
    emitWorkspaceEvent: (event: ChatWorkspaceEvent) => { events.push(event) },
    chatRowsEmitState: { rows: null, selectedPaneId: null }
  } as unknown as PeerManagerSupportHost

  peerManagerEmitChats(host)
  peerManagerEmitChats(host)
  assert.equal(events.length, 1)
  assert.equal(events[0]?.type === 'chats' && events[0].chats[0]?.paneId, record.id)

  store.update(record.id, {
    checkpoint: {
      version: 1,
      revision: 1,
      threadId: record.threadId ?? 'thread',
      throughItemId: 'u1',
      createdAt: 1,
      state: { goal: '', constraints: [], decisions: [], progress: [], nextSteps: [], files: [] }
    }
  })
  peerManagerEmitChats(host)
  assert.equal(events.length, 1, 'checkpoint-only store writes do not repaint the drawer')
})
