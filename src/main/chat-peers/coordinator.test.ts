import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChatStore } from '../chat-store/chat-store.js'
import { findCoordinatorWorkspace, normalizeCoordinatorGroup, pickCoordinatorWorker } from './coordinator.js'

test('normalizeCoordinatorGroup accepts coordinator and worker shapes', () => {
  assert.deepEqual(normalizeCoordinatorGroup({ id: 'g1', role: 'coordinator', slot: null }), {
    id: 'g1', role: 'coordinator', slot: null
  })
  assert.deepEqual(normalizeCoordinatorGroup({ id: 'g1', role: 'worker', slot: 'b' }), {
    id: 'g1', role: 'worker', slot: 'b'
  })
  assert.equal(normalizeCoordinatorGroup({ id: 'g1', role: 'worker' }), null)
})

test('pickCoordinatorWorker prefers an idle worker slot', () => {
  const store = ChatStore.inMemory([
    {
      id: 'coord', cwd: '/tmp', projectPath: null, provider: 'cursor', modelId: 'cursor:x', reasoningEffort: null,
      codexThreadId: null, claudeSessionId: null, antigravityConversationId: null, cursorSessionId: null,
      threadId: null, title: null, preview: '', createdAt: 1, updatedAt: 1, lastTurnEndedAt: null, messageSentAt: null,
      archived: false, pinnedAt: null, continuation: null, checkpoint: null, parentChatId: null,
      coordinatorGroup: { id: 'g', role: 'coordinator', slot: null }, sessionRotations: []
    },
    {
      id: 'wa', cwd: '/tmp', projectPath: null, provider: 'cursor', modelId: 'cursor:x', reasoningEffort: null,
      codexThreadId: null, claudeSessionId: null, antigravityConversationId: null, cursorSessionId: null,
      threadId: null, title: 'Worker A', preview: '', createdAt: 1, updatedAt: 1, lastTurnEndedAt: null, messageSentAt: null,
      archived: false, pinnedAt: null, continuation: null, checkpoint: null, parentChatId: 'coord',
      coordinatorGroup: { id: 'g', role: 'worker', slot: 'a' }, sessionRotations: []
    },
    {
      id: 'wb', cwd: '/tmp', projectPath: null, provider: 'cursor', modelId: 'cursor:x', reasoningEffort: null,
      codexThreadId: null, claudeSessionId: null, antigravityConversationId: null, cursorSessionId: null,
      threadId: null, title: 'Worker B', preview: '', createdAt: 1, updatedAt: 1, lastTurnEndedAt: null, messageSentAt: null,
      archived: false, pinnedAt: null, continuation: null, checkpoint: null, parentChatId: 'coord',
      coordinatorGroup: { id: 'g', role: 'worker', slot: 'b' }, sessionRotations: []
    }
  ])
  assert.equal(pickCoordinatorWorker(store, 'coord', (id) => id === 'wa'), 'wb')
})

test('findCoordinatorWorkspace returns coordinator and first worker', () => {
  const store = ChatStore.inMemory([
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
  assert.deepEqual(findCoordinatorWorkspace(store), {
    groupId: 'g', coordinatorPaneId: 'coord', workerPaneId: 'worker'
  })
})
