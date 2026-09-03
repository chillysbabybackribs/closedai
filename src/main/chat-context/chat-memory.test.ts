import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
import type { ChatContinuation } from '../../shared/types.js'
import { AppSettingsStore, DEFAULT_APP_SETTINGS, type AppSettingsAccess } from '../app-settings-store.js'
import { PeerSettings } from '../chat-peers/peer-settings.js'
import { ChatMemory } from './chat-memory.js'

const state = { goal: 'Optimize long chats', constraints: ['Keep history'], decisions: [], progress: [], nextSteps: ['Measure recall'], files: [] }
const caller = { paneId: 'p', threadId: 'thread', turnId: 't' }

function harness() {
  const snapshot: ChatSnapshot = {
    provider: 'codex', connection: { state: 'ready', message: '' }, account: null, models: [], selectedModel: null,
    selectedReasoningEffort: null, cwd: '/project', threadId: 'thread', threadName: null, activeTurnId: 't',
    contextUsage: null, planUsage: null, turnContext: null,
    items: [{ type: 'user', id: 'u1', turnId: 't', text: 'Keep the old constraints' }]
  }
  let settings = { ...DEFAULT_APP_SETTINGS, chatSelectedPaneId: 'p', chatPeers: [{
    paneId: 'p', provider: 'codex' as const, threadId: 'thread', codexThreadId: 'thread', claudeSessionId: null,
    modelId: null, reasoningEffort: null
  }] } as typeof DEFAULT_APP_SETTINGS
  let reads = 0
  let read = async (threadId: string): Promise<ChatThreadContent> => ({ threadId, threadName: null, items: [
    { type: 'user', id: 'old', turnId: 'old-t', text: 'Earlier decision' },
    { type: 'user', id: 'future', turnId: 'future-t', text: 'After the branch' }
  ] })
  const store: AppSettingsAccess = {
    get: () => settings,
    set: async (patch) => { settings = { ...settings, ...patch }; return settings }
  }
  const surface = {
    snapshot: () => snapshot,
    readThread: async (id: string) => { reads++; return read(id) }
  }
  const memory = new ChatMemory(store, (paneId) => paneId === 'p' ? surface : null)
  const source = (patch: Partial<ChatContinuation> = {}) => {
    settings.chatPeers[0]!.continuation = {
      sourcePaneId: 'closed-pane', sourceThreadId: 'old-thread', sourceProvider: 'codex', sourceTitle: 'Old',
      sourceThroughItemId: 'old', handoff: null, createdAt: 1, ...patch
    }
  }
  return { memory, store, snapshot, source, surface, reads: () => reads,
    setRead: (value: typeof read) => { read = value } }
}

test('save is caller-scoped, revision checked, and read back without provider traffic', async () => {
  const h = harness()
  const saved = await h.memory.save(caller, 0, state)
  assert.equal(saved.revision, 1)
  assert.equal(saved.throughItemId, 'u1')
  await assert.rejects(h.memory.save(caller, 0, state), /revision changed/)
  const recalled = await h.memory.recall(caller, { scope: 'current' })
  assert.deepEqual(recalled.checkpoint?.state, state)
  assert.equal(h.reads(), 0)
  assert.equal((await h.memory.save(caller, 1, state)).revision, 2)
  await assert.rejects(h.memory.save({ ...caller, paneId: 'other' }, 2, state), /calling pane/)
  await assert.rejects(h.memory.save({ ...caller, threadId: 'other' }, 2, state), /calling pane/)
  await assert.rejects(h.memory.save({ ...caller, turnId: 'old' }, 2, state), /active turn/)
  await assert.rejects(h.memory.save(caller, 2, { ...state, goal: 'x'.repeat(2_000) }), /Goal/)
  assert.equal(h.store.get().chatPeers[0]!.checkpoint!.revision, 2)
})

test('recalls a closed continuation source without opening or changing the current conversation', async () => {
  const h = harness()
  h.source()
  const result = await h.memory.recall(caller, { scope: 'source' })
  assert.equal(h.reads(), 1)
  assert.equal(h.snapshot.threadId, 'thread')
  assert.deepEqual(result.matches.map((item) => item.text), ['Earlier decision'])
  assert.equal(result.throughItemId, 'old')
  h.source({ sourceThroughItemId: undefined })
  await assert.rejects(h.memory.recall(caller, { scope: 'source' }), /no bounded continuation source/)
  assert.equal(h.reads(), 1)
})

test('a switched conversation or aborted caller cannot receive a pending source read', async () => {
  const h = harness()
  h.source()
  let finish!: (value: ChatThreadContent) => void
  h.setRead(() => new Promise((resolve) => { finish = resolve }))
  const pending = h.memory.recall(caller, { scope: 'source' })
  h.snapshot.threadId = 'new-thread'
  finish({ threadId: 'old-thread', threadName: null, items: [] })
  await assert.rejects(pending, /calling pane/)
  h.snapshot.threadId = 'thread'
  const signal = AbortSignal.abort()
  await assert.rejects(h.memory.recall({ ...caller, signal }, { scope: 'current' }), /cancelled/)
  await assert.rejects(h.memory.save({ ...caller, signal }, 0, state), /cancelled/)
})

test('switching providers never imports the previous provider checkpoint into current recall', async () => {
  const h = harness()
  await h.memory.save(caller, 0, state)
  h.snapshot.threadId = 'claude:new-session'
  const result = await h.memory.recall({ ...caller, threadId: h.snapshot.threadId }, { scope: 'current' })
  assert.equal(result.checkpoint, null)
})

test('checkpoints and frozen source boundaries survive disk reload and ordinary peer preference updates', async () => {
  const h = harness()
  const checkpoint = await h.memory.save(caller, 0, state)
  h.source({ checkpoint })
  const dir = await mkdtemp(join(tmpdir(), 'closedai-memory-'))
  const file = join(dir, 'app-settings.json')
  const store = await AppSettingsStore.open(file)
  await store.set(h.store.get())
  const peer = new PeerSettings(store, 'p')
  await peer.set({ chatReasoningEffort: 'high' })
  const loaded = await AppSettingsStore.open(file)
  assert.deepEqual(loaded.get().chatPeers[0]!.checkpoint, checkpoint)
  assert.deepEqual(loaded.get().chatPeers[0]!.continuation?.checkpoint, checkpoint)
  assert.equal(loaded.get().chatPeers[0]!.continuation?.sourceThroughItemId, 'old')
})
