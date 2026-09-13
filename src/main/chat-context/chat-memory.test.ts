import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
import type { ChatContinuation } from '../../shared/types.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import { chatRecord, MemorySettings } from '../chat-peers/peer-manager-harness.js'
import { PeerSettings } from '../chat-peers/peer-settings.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { ChatMemory } from './chat-memory.js'

const state = { goal: 'Optimize long chats', constraints: ['Keep history'], decisions: [], progress: [], nextSteps: ['Measure recall'], files: [] }
const caller = { paneId: 'p', threadId: 'thread', turnId: 't' }

function harness() {
  const snapshot: ChatSnapshot = {
    provider: 'codex', connection: { state: 'ready', message: '' }, account: null, models: [], selectedModel: null,
    selectedReasoningEffort: null, cwd: '/project', threadId: 'thread', threadName: null, activeTurnId: 't', pausedTurnId: null,
    contextUsage: null, planUsage: null, turnContext: null,
    items: [{ type: 'user', id: 'u1', turnId: 't', text: 'Keep the old constraints' }]
  }
  const store = ChatStore.inMemory([chatRecord('p', null, { codexThreadId: 'thread', threadId: 'thread' })])
  let reads = 0
  let read = async (threadId: string, _cwd?: string): Promise<ChatThreadContent> => ({ threadId, threadName: null, items: [
    { type: 'user', id: 'old', turnId: 'old-t', text: 'Earlier decision' },
    { type: 'user', id: 'future', turnId: 'future-t', text: 'After the branch' }
  ] })
  const surface = {
    snapshot: () => snapshot,
    readThread: async (id: string, cwd?: string) => { reads++; return read(id, cwd) }
  }
  const memory = new ChatMemory(store, (paneId) => paneId === 'p' ? surface : null)
  const source = (patch: Partial<ChatContinuation> = {}) => {
    store.update('p', { continuation: {
      sourcePaneId: 'closed-pane', sourceThreadId: 'old-thread', sourceProvider: 'codex', sourceTitle: 'Old',
      sourceThroughItemId: 'old', handoff: null, createdAt: 1, ...patch
    } })
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
  assert.equal(h.store.require('p').checkpoint!.revision, 2)
})

function addHistory(store: ChatStore, id: string, activity: number, patch: Partial<ChatRecord> = {}) {
  return store.create(chatRecord(id, null, {
    codexThreadId: `thread-${id}`, threadId: `thread-${id}`, messageSentAt: activity,
    title: id, createdAt: 1, updatedAt: activity, ...patch
  }))
}

test('history discovery prioritizes user activity across projects without reading transcripts', () => {
  const h = harness()
  addHistory(h.store, 'recent', 30, { cwd: '/other-project' })
  addHistory(h.store, 'background', 10, { updatedAt: 1000, lastTurnEndedAt: 1000, pinnedAt: 1000 })
  addHistory(h.store, 'middle', 20)
  addHistory(h.store, 'archived', 100, { archived: true })
  addHistory(h.store, 'blank', 100, { codexThreadId: null, threadId: null })
  addHistory(h.store, 'empty-thread', 100, { messageSentAt: null })
  const first = h.memory.history(caller, { limit: 2 })
  assert.deepEqual(first.chats.map((chat) => chat.chatId), ['recent', 'middle'])
  assert.equal(first.chats[0]!.cwd, '/other-project')
  assert.equal(first.nextBeforeChatId, 'middle')
  // New activity above the cursor does not cause previously read chats to repeat.
  addHistory(h.store, 'newer', 40)
  assert.deepEqual(h.memory.history(caller, { beforeChatId: 'middle' }).chats.map((chat) => chat.chatId), ['background'])
  assert.deepEqual(h.memory.history(caller, { cwd: '/other-project' }).chats.map((chat) => chat.chatId), ['recent'])
  assert.equal(h.reads(), 0)
  assert.throws(() => h.memory.history(caller, { beforeChatId: 'missing' }), /cursor/)
})

test('metadata search finds an older topic and applicable notes without claiming transcript search', () => {
  const h = harness()
  addHistory(h.store, 'recent', 30)
  addHistory(h.store, 'older', 10, { title: 'Layout decisions', checkpoint: {
    version: 1, revision: 1, threadId: 'thread-older', throughItemId: 'old', createdAt: 1,
    state: { ...state, goal: 'Remember purple buttons' }
  } })
  assert.deepEqual(h.memory.history(caller, { query: 'LAYOUT' }).chats.map((chat) => chat.chatId), ['older'])
  assert.deepEqual(h.memory.history(caller, { query: 'purple' }).chats.map((chat) => chat.chatId), ['older'])
  assert.deepEqual(h.memory.history(caller, { query: 'Earlier decision' }).chats, [])
  h.store.update('older', { codexThreadId: 'replacement' })
  assert.deepEqual(h.memory.history(caller, { query: 'purple' }).chats, [])
  assert.equal(h.reads(), 0)
})

test('history recalls the latest chat by default or an explicit older chat through its provider and project', async () => {
  const h = harness()
  addHistory(h.store, 'older', 10)
  addHistory(h.store, 'recent', 30, { provider: 'claude', claudeSessionId: 'recent-session', cwd: '/other-project' })
  const reads: unknown[] = []
  h.setRead(async (threadId, cwd) => {
    reads.push({ threadId, cwd })
    return { threadId, threadName: null, items: [{ type: 'user', id: 'old', turnId: null, text: `Decision in ${threadId}` }] }
  })
  const latest = await h.memory.recall(caller, { scope: 'history' })
  assert.equal(latest.chatId, 'recent')
  assert.equal(latest.threadId, 'claude:recent-session')
  assert.deepEqual(reads[0], { threadId: 'claude:recent-session', cwd: '/other-project' })
  const older = await h.memory.recall(caller, { scope: 'history', chatId: 'older', query: 'Decision' })
  assert.equal(older.chatId, 'older')
  assert.equal(older.matches[0]!.text, 'Decision in thread-older')
  assert.equal(h.snapshot.threadId, 'thread')
  await assert.rejects(h.memory.recall(caller, { scope: 'history', chatId: 'missing' }), /No matching conversation/)
  await assert.rejects(h.memory.recall(caller, { scope: 'source', chatId: 'older' }), /requires history/)
})

test('live history is reused, while an empty parked snapshot falls back to provider history', async () => {
  const h = harness()
  addHistory(h.store, 'recent', 30)
  let items = [{ type: 'user' as const, id: 'live', turnId: null, text: 'Live decision' }]
  const memory = new ChatMemory(h.store, (id) => id === 'p' ? h.surface : id === 'recent' ? {
    snapshot: () => ({ ...h.snapshot, threadId: 'thread-recent', items }), readThread: h.surface.readThread
  } : null)
  assert.equal((await memory.recall(caller, { scope: 'history' })).matches[0]!.text, 'Live decision')
  assert.equal(h.reads(), 0)
  items = []
  await memory.recall(caller, { scope: 'history' })
  assert.equal(h.reads(), 1)
})

test('pending history rejects cancellation, changed targets, and mismatched provider responses', async () => {
  const h = harness()
  addHistory(h.store, 'recent', 30)
  let finish!: (value: ChatThreadContent) => void
  h.setRead(() => new Promise((resolve) => { finish = resolve }))
  const pending = h.memory.recall(caller, { scope: 'history' })
  h.store.update('recent', { codexThreadId: 'replacement' })
  finish({ threadId: 'thread-recent', threadName: null, items: [] })
  await assert.rejects(pending, /History chat changed/)
  const controller = new AbortController()
  const cancelled = h.memory.recall({ ...caller, signal: controller.signal }, { scope: 'history' })
  controller.abort()
  finish({ threadId: 'replacement', threadName: null, items: [] })
  await assert.rejects(cancelled, /cancelled/)
  h.setRead(async () => ({ threadId: 'wrong', threadName: null, items: [] }))
  await assert.rejects(h.memory.recall(caller, { scope: 'history' }), /different history thread/)
})

test('history discovery stays within its serialized output budget', () => {
  const h = harness()
  for (let i = 1; i <= 8; i++) addHistory(h.store, `h${i}`, i, {
    title: '\u0000'.repeat(120), preview: '\u0000'.repeat(240), cwd: '/path'.repeat(200)
  })
  const first = h.memory.history(caller, { limit: 8 })
  assert.ok(JSON.stringify(first).length <= 16_000)
  assert.ok(first.chats.length > 0 && first.chats.length < 8)
  assert.equal(first.nextBeforeChatId, first.chats.at(-1)!.chatId)
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
  const file = join(dir, 'chats.json')
  const onDisk = await ChatStore.open(file)
  onDisk.create(h.store.require('p'))
  const settings = new MemorySettings({ ...DEFAULT_APP_SETTINGS, chatSelectedPaneId: 'p', chatOpenIds: ['p'] })
  const peer = new PeerSettings(settings, onDisk, 'p')
  await peer.set({ chatReasoningEffort: 'high' })
  await onDisk.flush()
  const loaded = await ChatStore.open(file)
  assert.deepEqual(loaded.require('p').checkpoint, checkpoint)
  assert.deepEqual(loaded.require('p').continuation?.checkpoint, checkpoint)
  assert.equal(loaded.require('p').continuation?.sourceThroughItemId, 'old')
  assert.equal(loaded.require('p').reasoningEffort, 'high')
  assert.equal(settings.get().chatReasoningEffort, 'high', 'the selected chat mirrors into the flat fields')
})
