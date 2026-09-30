/**
 * C3 contract probes: orientation runtime + pane recall/search tool honesty.
 * Run: npm run harness:orientation
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RUNTIME_CONTEXT, buildRuntimeAdditionalContext } from './runtime-context.js'
import { buildTurnSendContext } from './session-guide.js'
import { ChatMemory } from './chat-memory.js'
import { chatRecord } from '../chat-peers/peer-manager-harness.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { ChatPaneLexicalIndex } from '../chat-store/chat-pane-lexical-index.js'
import { buildFtsMatchQuery, ChatPaneLexicalFts } from '../chat-store/chat-pane-lexical-fts.js'
import { checkpointIndexItemId } from '../../shared/chat-index-checkpoint.js'
import { CHAT_PANE_LEXICAL_INDEX_VERSION } from '../../shared/chat-index.js'
import { AppCommandAccess } from '../app-commands.js'
import type { AppChatWorkspace } from '../tools/app/host.js'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import type { ChatSnapshot } from '../../shared/chat.js'

const SEED_PHRASE = 'C3_PROBE_MAGENTA_SIDEBAR_9137'
const caller = { paneId: 'probe-pane', threadId: 'thread', turnId: 't' }

test('C3 probe: runtime block is factual and names closedai_app.state verification', () => {
  const block = buildRuntimeAdditionalContext({
    paneId: 'probe-pane',
    provider: 'cursor',
    cwd: '/project',
    chatMemoryIndexEnabled: true,
    sessionGuideOnTurn: false
  })
  const payload = JSON.parse(block[RUNTIME_CONTEXT]!.value)
  assert.equal(payload.host, 'closedai')
  assert.equal(payload.paneId, 'probe-pane')
  assert.match(payload.verify, /closedai_app\.state/)
})

test('C3 probe: clock precedes runtime in turn send context', () => {
  const { context } = buildTurnSendContext({
    threadKey: 'k',
    state: { lastDeliveredThreadKey: 'k' },
    transcriptWasEmpty: false,
    pendingHandoff: null,
    runtime: {
      paneId: 'p',
      provider: 'codex',
      cwd: '/w',
      chatMemoryIndexEnabled: true,
      sessionGuideOnTurn: false
    },
    browserContext: undefined
  })
  const keys = Object.keys(context!)
  assert.equal(keys[0], 'closedai.clock')
  assert.equal(keys[1], 'closedai.runtime')
})

test('C3 probe: recall scope chat finds a seeded user phrase', async () => {
  const snapshot = {
    provider: 'codex' as const,
    connection: { state: 'ready' as const, message: '' },
    account: null,
    models: [],
    selectedModel: null,
    selectedReasoningEffort: null,
    cwd: '/project',
    threadId: 'thread',
    threadName: null,
    activeTurnId: 't',
    pausedTurnId: null,
    contextUsage: null,
    planUsage: null,
    items: [{ type: 'user' as const, id: 'u-seed', turnId: 't', text: `Constraint: ${SEED_PHRASE}` }]
  }
  const store = ChatStore.inMemory([chatRecord('probe-pane', null, { codexThreadId: 'thread', threadId: 'thread' })])
  const memory = new ChatMemory(store, (id) => id === 'probe-pane' ? { snapshot: () => snapshot, readThread: async () => ({ threadId: 'thread', threadName: null, items: [] }) } : null)
  const result = await memory.recall(caller, { scope: 'chat', query: SEED_PHRASE })
  assert.ok(result.matches.some((m) => m.text.includes(SEED_PHRASE)))
})

test('C3 probe: search scope chat hit drills down via recall item_id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-c3-'))
  const settings = { chatMemoryIndexEnabled: true, chatMemoryIndexMaxCharsPerChat: 48_000 }
  const record = chatRecord('probe-pane', null, { codexThreadId: 'thread', threadId: 'thread' })
  const index = new ChatPaneLexicalIndex(dir, () => settings)
  await index.load()
  index.upsert(record, [{ type: 'user', id: 'u-seed', turnId: 't', text: `Remember ${SEED_PHRASE} always` }], {
    rotationEpoch: 0,
    partial: false
  })
  const search = index.searchPane('probe-pane', { scope: 'chat', query: SEED_PHRASE, limit: 3 })
  assert.ok(search.hits.length > 0, 'search should index the seeded phrase')
  const hit = search.hits[0]!
  const store = ChatStore.inMemory([record])
  const snapshot = {
    provider: 'codex' as const,
    connection: { state: 'ready' as const, message: '' },
    account: null,
    models: [],
    selectedModel: null,
    selectedReasoningEffort: null,
    cwd: '/project',
    threadId: 'thread',
    threadName: null,
    activeTurnId: 't',
    pausedTurnId: null,
    contextUsage: null,
    planUsage: null,
    items: [{ type: 'user' as const, id: hit.itemId, turnId: 't', text: `Remember ${SEED_PHRASE} always` }]
  }
  const memory = new ChatMemory(store, (id) => id === 'probe-pane' ? { snapshot: () => snapshot, readThread: async () => snapshot } : null)
  const recalled = await memory.recall(caller, { scope: 'chat', itemId: hit.itemId })
  assert.match(recalled.matches[0]?.text ?? '', new RegExp(SEED_PHRASE))
})

test('C3 probe: FTS search returns the seeded line when disk sqlite is used', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-c3-fts-'))
  const fts = new ChatPaneLexicalFts(dir)
  fts.open()
  const record = {
    version: CHAT_PANE_LEXICAL_INDEX_VERSION,
    chatId: 'probe-pane',
    cwd: '/project',
    title: 'Probe',
    lastActivityAt: 1,
    rotationEpoch: 0,
    partial: false,
    updatedAt: 1,
    lines: [{ itemId: 'u1', role: 'user' as const, text: `Token line ${SEED_PHRASE} end` }]
  }
  fts.replaceChat(record)
  const match = buildFtsMatchQuery(SEED_PHRASE)!
  const hits = fts.search('probe-pane', match, 3)
  assert.equal(hits[0]?.itemId, 'u1')
})

test('C3 probe: app state memory flag aligns with runtime facts source', () => {
  const snapshot = chatSnapshotForProbe()
  const chat: AppChatWorkspace = {
    projectSwitch: { request: async (r) => ({ ...r, status: 'pending' as const }), cancel: () => null, state: () => null },
    snapshot: (): ChatWorkspaceSnapshot => ({
      selectedPaneId: 'probe-pane',
      selected: snapshot,
      chats: [{
        paneId: 'probe-pane', parentPaneId: null, kind: 'peer', provider: 'cursor', modelId: 'm',
        pinnedAt: null, threadId: 'thread', title: 't', preview: '', running: false, activity: null,
        updatedAt: 1, attached: true, cwd: '/project', createdAt: 1, lastTurnEndedAt: null
      }]
    }),
    paneSnapshot: () => snapshot,
    newPeer: async () => 'probe-pane',
    send: async () => {},
    interrupt: async () => {},
    on: () => {},
    off: () => {},
    selectPane: async () => {},
    openThread: async () => {},
    closePeer: async () => {},
    selectModel: async () => {},
    selectReasoningEffort: async () => {},
    listThreads: async () => []
  }
  const host = new AppCommandAccess({
    chat: () => chat,
    browser: () => null,
    downloads: () => null,
    window: () => null,
    facts: () => ({ appVersion: '9.9.9', chatMemoryIndexEnabled: false })
  })
  const runtime = buildRuntimeAdditionalContext({
    paneId: 'probe-pane',
    provider: 'cursor',
    cwd: '/project',
    chatMemoryIndexEnabled: false,
    sessionGuideOnTurn: false
  })
  const memory = (host.state(['chat'], undefined, 'probe-pane').chat as Record<string, unknown>).memory as Record<string, unknown>
  assert.equal(memory.chatMemoryIndexEnabled, JSON.parse(runtime['closedai.runtime']!.value).chatMemoryIndexEnabled)
})

function chatSnapshotForProbe(): ChatSnapshot {
  return {
    provider: 'cursor',
    connection: { state: 'ready', message: '' },
    account: null,
    models: [],
    selectedModel: 'cursor:test',
    selectedReasoningEffort: null,
    cwd: '/project',
    threadId: 'thread',
    threadName: null,
    activeTurnId: null,
    pausedTurnId: null,
    contextUsage: null,
    planUsage: null,
    items: []
  }
}

test('C3 probe: checkpoint facet search id recalls facet text', async () => {
  const store = ChatStore.inMemory([chatRecord('probe-pane', null, {
    codexThreadId: 'thread',
    threadId: 'thread',
    checkpoint: {
      version: 1,
      revision: 1,
      threadId: 'thread',
      throughItemId: 'u1',
      createdAt: 1,
      state: {
        goal: 'Probe goal',
        constraints: [SEED_PHRASE],
        decisions: [],
        progress: [],
        nextSteps: [],
        files: []
      }
    }
  })])
  const snapshot = {
    provider: 'codex' as const,
    connection: { state: 'ready' as const, message: '' },
    account: null,
    models: [],
    selectedModel: null,
    selectedReasoningEffort: null,
    cwd: '/project',
    threadId: 'thread',
    threadName: null,
    activeTurnId: 't',
    pausedTurnId: null,
    contextUsage: null,
    planUsage: null,
    items: [{ type: 'user' as const, id: 'u1', turnId: 't', text: 'hi' }]
  }
  const memory = new ChatMemory(store, (id) => id === 'probe-pane' ? { snapshot: () => snapshot, readThread: async () => snapshot } : null)
  const itemId = checkpointIndexItemId('u1', 'constraints.0')
  const result = await memory.recall(caller, { scope: 'chat', itemId })
  assert.match(result.matches[0]?.text ?? '', new RegExp(SEED_PHRASE))
})
