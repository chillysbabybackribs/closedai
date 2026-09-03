import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type {
  ChatEvent,
  ChatModel,
  ChatProvider,
  ChatSnapshot,
  ChatThreadContent,
  ChatThreadSummary,
  ChatTranscriptItem
} from '../shared/chat.js'
import type { AppSettings } from '../shared/types.js'
import { DEFAULT_APP_SETTINGS, type AppSettingsAccess } from './app-settings-store.js'
import type { ThreadHandoffSource } from './chat-context/thread-handoff.js'
import { ChatHub, type ChatHubProviders } from './chat-hub.js'

/** The pane's slice of settings, which is all the hub writes to. */
class FakeSettings implements AppSettingsAccess {
  saved: AppSettings = { ...DEFAULT_APP_SETTINGS }
  get(): AppSettings { return { ...this.saved } }
  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.saved = { ...this.saved, ...patch }
    return this.get()
  }
}

function model(provider: ChatProvider, id: string): ChatModel {
  return { provider, id, displayName: id, description: '', defaultReasoningEffort: 'high', supportedReasoningEfforts: [], isDefault: false }
}

class FakeProvider extends EventEmitter {
  calls: string[] = []
  activeTurnId: string | null = null
  threads: ChatThreadSummary[] = []
  failThreads = false
  effort: string | null = 'high'
  items: ChatTranscriptItem[] = []
  continued: ThreadHandoffSource | null = null
  constructor(readonly provider: ChatProvider, private readonly models: ChatModel[]) { super() }
  snapshot(): ChatSnapshot {
    return {
      provider: this.provider, connection: { state: 'ready', message: `${this.provider} ready` }, account: null,
      models: this.models, selectedModel: this.models[0]?.id ?? null, selectedReasoningEffort: this.effort, cwd: '/w',
      threadId: `${this.provider}-thread`, threadName: null, activeTurnId: this.activeTurnId,
      contextUsage: null, planUsage: null, turnContext: null, items: this.items
    }
  }
  async start(options?: { warm?: boolean }): Promise<void> { this.calls.push(`start:${options?.warm ?? 'none'}`) }
  stop(): void { this.calls.push('stop') }
  async send(text: string): Promise<void> { this.calls.push(`send:${text}`) }
  async interrupt(): Promise<void> { this.calls.push('interrupt') }
  async selectModel(id: string): Promise<void> { this.calls.push(`selectModel:${id}`) }
  async selectReasoningEffort(effort: string): Promise<void> { this.calls.push(`effort:${effort}`) }
  async refreshPlanUsage(): Promise<void> { this.calls.push('refreshPlanUsage') }
  async listThreads(): Promise<ChatThreadSummary[]> { if (this.failThreads) throw new Error('down'); return this.threads }
  async readThread(threadId: string): Promise<ChatThreadContent> {
    this.calls.push(`read:${threadId}`)
    return { threadId, threadName: null, items: [] }
  }
  async newThread(): Promise<void> { this.calls.push('newThread'); this.items = [] }
  async continueInNewThread(from?: ThreadHandoffSource): Promise<void> {
    this.calls.push(from ? `continue:${from.provider}` : 'continue')
    this.continued = from ?? null
    this.items = []
  }
  async openThread(id: string): Promise<void> { this.calls.push(`openThread:${id}`) }
  async archiveThread(id: string): Promise<void> { this.calls.push(`archive:${id}`) }
  async beginChatGptLogin(): Promise<string> { this.calls.push('login'); return 'https://auth' }
}

function build(initialModel: string | null = null): {
  hub: ChatHub; codex: FakeProvider; claude: FakeProvider; antigravity: FakeProvider
  events: ChatEvent[]; settings: FakeSettings
} {
  const codex = new FakeProvider('codex', [model('codex', 'gpt-5.6-sol')])
  const claude = new FakeProvider('claude', [model('claude', 'claude:opus[1m]')])
  const antigravity = new FakeProvider('antigravity', [model('antigravity', 'agy:gemini-3.8-flash')])
  const settings = new FakeSettings()
  settings.saved.chatModelId = initialModel
  const hub = new ChatHub({ codex, claude, antigravity } as unknown as ChatHubProviders, initialModel, settings)
  const events: ChatEvent[] = []
  hub.on('event', (event: ChatEvent) => events.push(event))
  return { hub, codex, claude, antigravity, events, settings }
}

test('an agy model routes to the Antigravity provider and its threads merge into history', async () => {
  const { hub, antigravity, claude, codex } = build('agy:gemini-3.8-flash')
  assert.equal(hub.activeProvider, 'antigravity')
  await hub.start()
  assert.deepEqual(antigravity.calls, ['start:true'])
  assert.deepEqual(codex.calls, ['start:false'])
  antigravity.threads = [{ id: 'agy:c1', title: 'A', preview: '', createdAt: 1, updatedAt: 5 }]
  codex.threads = [{ id: 't1', title: 'C', preview: '', createdAt: 1, updatedAt: 3 }]
  assert.deepEqual((await hub.listThreads()).map((thread) => thread.id), ['agy:c1', 't1'])
  await hub.openThread('t1')
  assert.equal(hub.activeProvider, 'codex')
  await hub.archiveThread('agy:c1')
  assert.deepEqual(antigravity.calls.slice(-1), ['archive:agy:c1'])
  await hub.readThread('claude:session-1')
  assert.deepEqual(claude.calls.slice(-1), ['read:claude:session-1'])
})

test('the saved model decides the initial provider and which one starts warm', async () => {
  const codexFirst = build('gpt-5.6-sol')
  assert.equal(codexFirst.hub.activeProvider, 'codex')
  await codexFirst.hub.start()
  assert.deepEqual(codexFirst.claude.calls, ['start:false'])
  const claudeFirst = build('claude:opus[1m]')
  assert.equal(claudeFirst.hub.activeProvider, 'claude')
  await claudeFirst.hub.start()
  assert.deepEqual(claudeFirst.claude.calls, ['start:true'])
})

test('the snapshot is the active provider with every catalog merged', () => {
  const { hub } = build()
  const snapshot = hub.snapshot()
  assert.equal(snapshot.provider, 'codex')
  assert.deepEqual(snapshot.models.map((entry) => entry.id), ['gpt-5.6-sol', 'claude:opus[1m]', 'agy:gemini-3.8-flash'])
})

test('selecting the other provider switches the pane after that provider accepts the model', async () => {
  const { hub, codex, claude, events } = build()
  await hub.selectModel('claude:opus[1m]')
  assert.deepEqual(claude.calls, ['selectModel:claude:opus[1m]'])
  assert.equal(hub.activeProvider, 'claude')
  assert.equal(events.at(-1)?.type, 'replace')
  await hub.send('hi', [])
  assert.deepEqual(claude.calls.at(-1), 'send:hi')
  assert.deepEqual(codex.calls, [])
  await hub.selectModel('claude:opus[1m]')
  assert.equal(hub.activeProvider, 'claude')
})

test('switching provider keeps the current transcript when destination has none', async () => {
  const { hub, codex, claude } = build()
  codex.items = [{ type: 'user', id: 'user-1', turnId: 't1', text: 'Hello from the original chat' }]
  await hub.selectModel('claude:opus[1m]')
  assert.equal(hub.activeProvider, 'claude')
  assert.deepEqual(hub.snapshot().items, codex.items)
  assert.deepEqual(claude.calls.slice(-1), ['selectModel:claude:opus[1m]'])
})

test('a running turn blocks switching providers', async () => {
  const { hub, codex } = build()
  codex.activeTurnId = 'turn'
  await assert.rejects(hub.selectModel('claude:opus[1m]'), /Stop the current turn/)
  assert.equal(hub.activeProvider, 'codex')
})

test('threads merge newest first and route by id; one failing provider hides only its threads', async () => {
  const { hub, codex, claude, antigravity } = build()
  codex.threads = [{ id: 'c1', title: 'Codex', preview: '', createdAt: 1, updatedAt: 5 }]
  claude.threads = [{ id: 'claude:s1', title: 'Claude', preview: '', createdAt: 1, updatedAt: 9 }]
  assert.deepEqual((await hub.listThreads()).map((thread) => thread.id), ['claude:s1', 'c1'])
  claude.failThreads = true
  assert.deepEqual((await hub.listThreads()).map((thread) => thread.id), ['c1'])
  codex.failThreads = true
  antigravity.failThreads = true
  await assert.rejects(hub.listThreads(), /down/)
  claude.failThreads = false
  await hub.openThread('claude:s1')
  assert.equal(hub.activeProvider, 'claude')
  assert.deepEqual(claude.calls, ['openThread:claude:s1'])
  await hub.archiveThread('c1')
  assert.deepEqual(codex.calls, ['archive:c1'])
})

test('connection events from either provider re-describe the active one with merged models', () => {
  const { hub, claude, events } = build()
  claude.emit('event', { type: 'connection', provider: 'claude', connection: { state: 'ready', message: 'x' }, account: null, models: [], selectedModel: null, selectedReasoningEffort: null })
  const event = events.at(-1)
  assert.equal(event?.type, 'connection')
  if (event?.type !== 'connection') return
  assert.equal(event.provider, 'codex')
  assert.equal(event.connection.message, 'codex ready')
  assert.equal(event.models.length, 3)
  claude.emit('event', { type: 'turn', turnId: 't' })
  assert.equal(events.at(-1)?.type, 'connection')
  assert.equal(hub.activeProvider, 'codex')
})

test('login goes to ChatGPT on Codex and re-checks Claude Code otherwise', async () => {
  const { hub, codex, claude } = build()
  assert.equal(await hub.beginLogin(), 'https://auth')
  assert.deepEqual(codex.calls, ['login'])
  await hub.selectModel('claude:opus[1m]')
  assert.equal(await hub.beginLogin(), null)
  assert.deepEqual(claude.calls.at(-1), 'start:true')
})

test('opening another provider\u2019s thread saves the model that names the pane\u2019s provider', async () => {
  const { hub, claude, settings } = build('gpt-5.6-sol')
  claude.effort = 'medium'
  await hub.openThread('claude:s1')
  assert.equal(hub.activeProvider, 'claude')
  // Without this the pane record still reads gpt-5.6-sol and the next launch reopens on Codex.
  assert.equal(settings.saved.chatModelId, 'claude:opus[1m]')
  assert.equal(settings.saved.chatReasoningEffort, 'medium')
})

test('a switch the picker already saved is not written again', async () => {
  const { hub, settings } = build('gpt-5.6-sol')
  settings.saved.chatModelId = 'claude:opus[1m]'
  settings.saved.chatReasoningEffort = 'high'
  let writes = 0
  const set = settings.set.bind(settings)
  settings.set = async (patch) => { writes += 1; return set(patch) }
  await hub.selectModel('claude:opus[1m]')
  assert.equal(writes, 0)
  assert.equal(hub.activeProvider, 'claude')
})
