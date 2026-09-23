import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChatStore } from '../chat-store/chat-store.js'
import { openCoordinatorWorkspace, type PeerCoordinatorHost } from './peer-coordinator-ops.js'

function host(overrides: Partial<PeerCoordinatorHost> = {}): PeerCoordinatorHost & {
  retained: Set<string>
  attached: Set<string>
  selectedPane: string | null
} {
  const store = ChatStore.inMemory([
    {
      id: 'home', cwd: '/tmp', projectPath: null, provider: 'cursor', modelId: 'cursor:x', reasoningEffort: null,
      codexThreadId: null, claudeSessionId: null, antigravityConversationId: null, cursorSessionId: null,
      threadId: null, title: 'Home', preview: '', createdAt: 1, updatedAt: 1, lastTurnEndedAt: null, messageSentAt: null,
      archived: false, pinnedAt: null, continuation: null, checkpoint: null, parentChatId: null,
      coordinatorGroup: null, sessionRotations: []
    },
    {
      id: 'coord', cwd: '/tmp', projectPath: null, provider: 'cursor', modelId: 'cursor:x', reasoningEffort: null,
      codexThreadId: null, claudeSessionId: null, antigravityConversationId: null, cursorSessionId: null,
      threadId: null, title: 'Coordinator', preview: '', createdAt: 1, updatedAt: 1, lastTurnEndedAt: null, messageSentAt: null,
      archived: false, pinnedAt: null, continuation: null, checkpoint: null, parentChatId: null,
      coordinatorGroup: { id: 'g', role: 'coordinator', slot: null }, sessionRotations: []
    },
    {
      id: 'worker', cwd: '/tmp', projectPath: null, provider: 'cursor', modelId: 'cursor:x', reasoningEffort: null,
      codexThreadId: null, claudeSessionId: null, antigravityConversationId: null, cursorSessionId: null,
      threadId: null, title: 'Worker', preview: '', createdAt: 1, updatedAt: 1, lastTurnEndedAt: null, messageSentAt: null,
      archived: false, pinnedAt: null, continuation: null, checkpoint: null, parentChatId: 'coord',
      coordinatorGroup: { id: 'g', role: 'worker', slot: 'a' }, sessionRotations: []
    }
  ])
  const retained = new Set<string>()
  const attached = new Set<string>(['home'])
  const selection = { pane: 'home' as string | null }
  return {
    store,
    retained,
    attached,
    get selectedPane() { return selection.pane },
    assertAvailable: () => {},
    modelOf: () => ({ modelId: 'cursor:x', reasoningEffort: null }),
    selectedPaneId: () => selection.pane ?? 'home',
    createSeeded: async () => { throw new Error('not used in this test') },
    retainPane: (paneId) => {
      retained.add(paneId)
      attached.add(paneId)
    },
    selectPane: async (paneId) => {
      if (!attached.has(paneId)) throw new Error(`Unknown chat pane: ${paneId}`)
      selection.pane = paneId
    },
    settle: async () => {},
    ...overrides
  }
}

test('openCoordinatorWorkspace re-attains stored coordinator group before selecting', async () => {
  const h = host()
  const result = await openCoordinatorWorkspace(h)
  assert.deepEqual(result, { groupId: 'g', coordinatorPaneId: 'coord', workerPaneId: 'worker' })
  assert.equal(h.selectedPane, 'home')
  assert.deepEqual([...h.retained].sort(), ['coord', 'home', 'worker'])
})

test('openCoordinatorWorkspace normalizes stale crew tab titles on reopen', async () => {
  const h = host()
  h.store.update('coord', { title: 'New chat', titleSource: 'auto' })
  h.store.update('worker', { title: 'Worker A', titleSource: 'manual' })
  await openCoordinatorWorkspace(h)
  assert.equal(h.store.require('coord').title, 'Coordinator')
  assert.equal(h.store.require('worker').title, 'Worker')
})
