import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULT_APP_SETTINGS } from './app-settings-store.ts'
import type { AppSettings } from '../shared/types.ts'
import { ChatTranscript } from './chat-transcript.ts'
import { ToolRegistry } from './tools/registry.ts'
import { dynamicToolSpecs } from './tools/app-server-tools.ts'
import {
  CHAT_SERVICE_THREAD_CACHE_LIMIT,
  ensureCodexThread,
  readCachedThread,
  rememberThreadCache,
  type ChatServiceThreadHost
} from './chat-service-thread-lifecycle.ts'
import { ContextCompactor } from './chat-context/context-compaction.ts'
import { SessionRotator } from './chat-context/session-rotation.ts'
import { ChatModelState } from './chat-model-state.ts'

async function mockHost(t: test.TestContext, tools: ToolRegistry) {
  const directory = await mkdtemp(join(tmpdir(), 'closedai-thread-lifecycle-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let saved: AppSettings = { ...DEFAULT_APP_SETTINGS, chatSeamlessRotation: false }
  let threadId: string | null = 'live-thread'
  let threadToolCatalog: unknown = dynamicToolSpecs(tools)
  const requests: Array<{ method: string; params: unknown }> = []
  const transcript = new ChatTranscript(directory, () => null, () => undefined)
  const modelState = new ChatModelState()
  modelState.load({ models: [], selectedModel: null, selectedReasoningEffort: null })
  const threadCache = new Map<string, import('../shared/chat.js').ChatThreadContent>()
  const client = {
    async request(method: string, params: unknown) {
      requests.push({ method, params })
      if (method === 'thread/start') return { thread: { id: 'new-thread' } }
      if (method === 'thread/read') {
        const threadId = (params as { threadId: string }).threadId
        return { thread: { id: threadId, name: 'Read', turns: [] } }
      }
      return { thread: { id: 'live-thread' } }
    }
  }
  const compactor = new ContextCompactor({
    thresholdPercent: () => 80,
    thresholdTokens: () => 0,
    threadId: () => threadId,
    turnActive: () => false,
    request: (method, params) => client.request(method, params),
    notice: () => {}
  })
  const rotator = new SessionRotator({
    enabled: () => false,
    thresholdPercent: () => 80,
    thresholdTokens: () => 0,
    threadId: () => threadId,
    turnActive: () => false,
    rotate: async () => {}
  })
  const host: ChatServiceThreadHost = {
    cwd: directory,
    client: client as ChatServiceThreadHost['client'],
    tools,
    settings: {
      get: () => saved,
      async set(patch: Partial<AppSettings>) { saved = { ...saved, ...patch }; return saved },
      checkpoint: () => null,
      sessionRotations: () => saved.chatSessionRotations ?? []
    },
    paneId: 'pane',
    threadId: () => threadId,
    threadName: () => null,
    threadToolCatalog: () => threadToolCatalog,
    transcript,
    compactor,
    rotator,
    modelState,
    threadCache,
    ensureConnected: async () => {},
    contextManager: () => compactor,
    snapshot: () => ({
      provider: 'codex',
      connection: { state: 'ready', message: 'ok' },
      account: null,
      models: [],
      selectedModel: null,
      selectedReasoningEffort: null,
      cwd: directory,
      threadId,
      threadName: null,
      activeTurnId: null,
      pausedTurnId: null,
      contextUsage: null,
      planUsage: null,
      items: []
    }),
    emitEvent: () => {},
    setThreadId: (id) => { threadId = id },
    setThreadName: () => {},
    setThreadToolCatalog: (catalog) => { threadToolCatalog = catalog },
    setActiveTurnId: () => {},
  }
  return { host, requests, getSaved: () => saved, setThreadToolCatalog: (c: unknown) => { threadToolCatalog = c } }
}

test('ensureCodexThread reuses the live thread when the dynamic catalog still matches', async (t) => {
  const tools = new ToolRegistry([{
    name: 'probe', description: 'Probe', tools: [{
      name: 'read', description: 'Current', inputSchema: { type: 'object' },
      async run() { return { content: [{ type: 'text', text: 'ok' }] } }
    }]
  }])
  const { host, requests } = await mockHost(t, tools)
  assert.equal(await ensureCodexThread(host), 'live-thread')
  assert.equal(requests.filter((r) => r.method === 'thread/start').length, 0)
})

test('ensureCodexThread starts a fresh thread when the catalog drifts after resume', async (t) => {
  const tools = new ToolRegistry([{
    name: 'probe', description: 'Probe', tools: [{
      name: 'read', description: 'Current', inputSchema: { type: 'object' },
      async run() { return { content: [{ type: 'text', text: 'ok' }] } }
    }]
  }])
  const { host, requests, setThreadToolCatalog, getSaved } = await mockHost(t, tools)
  host.transcript.replaceItems([{ type: 'user', id: 'user:u1', turnId: null, text: 'Investigate the page' }])
  host.transcript.addOptimisticUser('pending-user', 'New request', [])
  const stale = structuredClone(dynamicToolSpecs(tools))
  stale[0]!.tools[0]!.description = 'Stale'
  setThreadToolCatalog(stale)
  assert.equal(await ensureCodexThread(host, 'pending-user'), 'new-thread')
  assert.equal(requests.filter((r) => r.method === 'thread/start').length, 1)
  assert.equal(getSaved().chatContinuation?.sourceThreadId, 'live-thread')
  assert.doesNotMatch(getSaved().chatContinuation?.handoff ?? '', /New request/)
})

test('readCachedThread serves non-live reads from a bounded cache', async (t) => {
  const tools = new ToolRegistry([])
  const { host } = await mockHost(t, tools)
  host.setThreadId('other-live')
  const first = await readCachedThread(host, 'cached-thread')
  assert.equal(first.threadId, 'cached-thread')
  assert.equal(host.threadCache.size, 1)
  const second = await readCachedThread(host, 'cached-thread')
  assert.equal(second, first)
})

test('rememberThreadCache evicts the oldest entry at the limit', () => {
  const host = {
    threadCache: new Map<string, import('../shared/chat.js').ChatThreadContent>()
  } as unknown as ChatServiceThreadHost
  for (let index = 0; index <= CHAT_SERVICE_THREAD_CACHE_LIMIT; index += 1) {
    rememberThreadCache(host, `thread-${index}`, { threadId: `thread-${index}`, threadName: null, items: [] })
  }
  assert.equal(host.threadCache.size, CHAT_SERVICE_THREAD_CACHE_LIMIT)
  assert.ok(!host.threadCache.has('thread-0'))
})
