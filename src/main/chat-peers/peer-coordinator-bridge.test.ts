import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChatStore } from '../chat-store/chat-store.js'
import {
  onCoordinatorUserMessage,
  onCoordinatorTurnEnded,
  onWorkerTurnEnded,
  resetCoordinatorBridgeForTests,
  WORKER_FINISHED_PREFIX,
  type CoordinatorBridgeHost
} from './peer-coordinator-bridge.js'
import type { ChatSnapshot } from '../../shared/chat.js'

function host(overrides: Partial<CoordinatorBridgeHost> = {}): CoordinatorBridgeHost & { sends: Array<[string, string]> } {
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
  const sends: Array<[string, string]> = []
  const snapshots = new Map<string, ChatSnapshot>()
  const base: CoordinatorBridgeHost & { sends: Array<[string, string]> } = {
    store,
    sends,
    send: async (paneId, text) => { sends.push([paneId, text]) },
    isRunning: () => false,
    markInternalSend: () => {},
    unmarkInternalSend: () => {},
    snapshot: (paneId) => snapshots.get(paneId) ?? null,
    ...overrides
  }
  return Object.assign(base, { setSnapshot: (paneId: string, snapshot: ChatSnapshot) => { snapshots.set(paneId, snapshot) } })
}

function snap(items: ChatSnapshot['items']): ChatSnapshot {
  return {
    provider: 'cursor', connection: { state: 'ready', message: '' }, account: null, models: [],
    selectedModel: 'cursor:x', selectedReasoningEffort: null, cwd: '/tmp', threadId: null, threadName: null,
    activeTurnId: null, pausedTurnId: null, contextUsage: null, planUsage: null, items
  }
}

test('coordinator user message forwards the same text to worker', async () => {
  resetCoordinatorBridgeForTests()
  const h = host()
  await onCoordinatorUserMessage(h, 'coord', 'Research infinite loops')
  assert.deepEqual(h.sends, [['worker', 'Research infinite loops']])
})

test('worker turn ended alerts coordinator immediately', async () => {
  resetCoordinatorBridgeForTests()
  const h = host() as ReturnType<typeof host> & { setSnapshot: (id: string, s: ChatSnapshot) => void }
  h.setSnapshot('worker', snap([{ type: 'assistant', id: 'a1', turnId: 't1', text: 'Found three papers.', phase: null, streaming: false }]))
  await onWorkerTurnEnded(h, 'worker')
  assert.equal(h.sends.length, 1)
  assert.equal(h.sends[0]![0], 'coord')
  assert.ok(h.sends[0]![1].startsWith(WORKER_FINISHED_PREFIX))
  assert.match(h.sends[0]![1], /Found three papers/)
})

test('coordinator turn after worker report forwards assistant reply to worker', async () => {
  resetCoordinatorBridgeForTests()
  const h = host() as ReturnType<typeof host> & { setSnapshot: (id: string, s: ChatSnapshot) => void }
  h.setSnapshot('worker', snap([{ type: 'assistant', id: 'a1', turnId: 't1', text: 'done step 1', phase: null, streaming: false }]))
  await onWorkerTurnEnded(h, 'worker')
  h.setSnapshot('coord', snap([{ type: 'assistant', id: 'a2', turnId: 't2', text: 'Now dig into paper two.', phase: null, streaming: false }]))
  await onCoordinatorTurnEnded(h, 'coord')
  assert.deepEqual(h.sends.at(-1), ['worker', 'Now dig into paper two.'])
})
