import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type {
  ChatConnectionState,
  ChatEvent,
  ChatHistoryWindow,
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
import { WorkspaceCatalogs } from './chat-context/provider-catalog-cache.js'
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
  compactConversation?: () => Promise<void>
  constructor(readonly provider: ChatProvider, public models: ChatModel[]) {
    super()
    this.threadId = `${provider}-thread`
  }
  hasEarlier = false
  threadId: string | null = null
  /** Fakes report ready by default; a test that needs a cold provider sets 'starting'. */
  connectionState: ChatConnectionState = 'ready'
  snapshot(window?: ChatHistoryWindow): ChatSnapshot {
    return {
      provider: this.provider, connection: { state: this.connectionState, message: `${this.provider} ready` }, account: null,
      models: this.models, selectedModel: this.models[0]?.id ?? null, selectedReasoningEffort: this.effort, cwd: '/w',
      threadId: this.threadId, threadName: null, activeTurnId: this.activeTurnId, pausedTurnId: null,
      contextUsage: null, planUsage: null, turnContext: null, items: this.items,
      ...(window ? { history: { hasEarlier: this.hasEarlier } } : {})
    }
  }
  replace(): void { this.emit('event', { type: 'replace', snapshot: this.snapshot() }) }
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

function build(initialModel: string | null = null, catalogs?: WorkspaceCatalogs): {
  hub: ChatHub; codex: FakeProvider; claude: FakeProvider; antigravity: FakeProvider; cursor: FakeProvider
  events: ChatEvent[]; settings: FakeSettings
} {
  const codex = new FakeProvider('codex', [model('codex', 'gpt-5.6-sol')])
  const claude = new FakeProvider('claude', [model('claude', 'claude:opus[1m]')])
  const antigravity = new FakeProvider('antigravity', [model('antigravity', 'agy:gemini-3.8-flash')])
  antigravity.compactConversation = async function(this: FakeProvider) {
    this.calls.push('compactConversation')
    this.threadId = null
  }
  const cursor = new FakeProvider('cursor', [model('cursor', 'cursor:claude-opus-5[effort=high]')])
  const settings = new FakeSettings()
  settings.saved.chatModelId = initialModel
  const hub = new ChatHub({ codex, claude, antigravity, cursor } as unknown as ChatHubProviders, initialModel, settings, { catalogs })
  const events: ChatEvent[] = []
  hub.on('event', (event: ChatEvent) => events.push(event))
  return { hub, codex, claude, antigravity, cursor, events, settings }
}

test('an agy model routes to the Antigravity provider and its threads merge into history', async () => {
  const { hub, antigravity, claude, codex } = build('agy:gemini-3.8-flash')
  assert.equal(hub.activeProvider, 'antigravity')
  await hub.start()
  assert.deepEqual(antigravity.calls, ['start:true'])
  assert.deepEqual(codex.calls, ['start:false', 'stop'])
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
  assert.deepEqual(codexFirst.claude.calls, ['start:false', 'stop'])
  const claudeFirst = build('claude:opus[1m]')
  assert.equal(claudeFirst.hub.activeProvider, 'claude')
  await claudeFirst.hub.start()
  assert.deepEqual(claudeFirst.claude.calls, ['start:true'])
  assert.deepEqual(claudeFirst.codex.calls, ['start:false', 'stop'])
})

test('with the workspace catalogs cached, only the active provider starts and the picker still lists every model', async () => {
  const catalogs = new WorkspaceCatalogs()
  catalogs.remember('claude', [model('claude', 'claude:opus[1m]')])
  catalogs.remember('antigravity', [model('antigravity', 'agy:gemini-3.8-flash')])
  catalogs.remember('cursor', [model('cursor', 'cursor:claude-opus-5[effort=high]')])
  const { hub, codex, claude, antigravity, cursor } = build('gpt-5.6-sol', catalogs)
  // The fakes report their own catalogs; empty them so the merged picker has to come from the cache.
  for (const fake of [claude, antigravity, cursor]) {
    fake.models = []
    fake.connectionState = 'starting'
  }

  await hub.start()
  assert.deepEqual(codex.calls, ['start:true'])
  assert.deepEqual(claude.calls, [])
  assert.deepEqual(antigravity.calls, [])
  assert.deepEqual(cursor.calls, [])
  assert.deepEqual(
    hub.snapshot().models.map((entry) => entry.id),
    ['gpt-5.6-sol', 'claude:opus[1m]', 'agy:gemini-3.8-flash', 'cursor:claude-opus-5[effort=high]']
  )

  // Picking a cached provider starts nothing: the pane records the pick and the one being left stops.
  await hub.selectModel('claude:opus[1m]')
  assert.deepEqual(claude.calls, ['newThread'])
  assert.deepEqual(codex.calls, ['start:true', 'stop'])
  // The first message is what starts it; the pick is handed over once it is up.
  await hub.send('hi', [])
  assert.deepEqual(claude.calls, ['newThread', 'start:true', 'selectModel:claude:opus[1m]', 'send:hi'])
})

test('a provider a pane reads cold shares its catalog with the workspace and stops again', async () => {
  const catalogs = new WorkspaceCatalogs()
  const { hub, claude } = build('gpt-5.6-sol', catalogs)
  await hub.start()
  assert.deepEqual(claude.calls, ['start:false', 'stop'])
  claude.emit('event', {
    type: 'connection',
    provider: 'claude',
    connection: { state: 'ready', message: 'ok' },
    account: null,
    models: [model('claude', 'claude:opus[1m]')],
    selectedModel: 'claude:opus[1m]',
    selectedReasoningEffort: null
  })
  assert.deepEqual(catalogs.read('claude')?.models.map((entry) => entry.id), ['claude:opus[1m]'])
})

test('a provider switch is a settings write: the pane is ready on the picked model and the process waits for the first send', async () => {
  const catalogs = new WorkspaceCatalogs()
  catalogs.remember('cursor', [model('cursor', 'cursor:claude-opus-5[effort=high]')])
  const { hub, codex, cursor, events, settings } = build('gpt-5.6-sol', catalogs)
  cursor.models = []
  cursor.connectionState = 'starting'
  let release!: () => void
  const started = new Promise<void>((resolve) => { release = resolve })
  cursor.start = async (options) => {
    cursor.calls.push(`start:${options?.warm ?? 'none'}`)
    await started
    cursor.connectionState = 'ready'
  }
  await hub.start()
  events.length = 0

  await hub.selectModel('cursor:claude-opus-5[effort=high]')
  assert.equal(hub.activeProvider, 'cursor')
  assert.deepEqual(cursor.calls, ['newThread'], 'nothing started for a pick')
  assert.deepEqual(codex.calls.at(-1), 'stop')
  assert.equal(settings.saved.chatModelId, 'cursor:claude-opus-5[effort=high]')
  const painted = events.at(-1)
  assert.equal(painted?.type, 'replace')
  if (painted?.type === 'replace') {
    // The composer is usable: the pane presents as ready on the picked model, not as a provider with nothing loaded.
    assert.equal(painted.snapshot.selectedModel, 'cursor:claude-opus-5[effort=high]')
    assert.equal(painted.snapshot.connection.state, 'ready')
  }
  assert.equal(hub.snapshot().connection.state, 'ready')

  const sending = hub.send('hello', [])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(cursor.calls, ['newThread', 'start:true'], 'the first send starts the provider and waits for it')
  release()
  await sending
  assert.deepEqual(cursor.calls, ['newThread', 'start:true', 'selectModel:cursor:claude-opus-5[effort=high]', 'send:hello'])
  // Once up, the provider's own state is what the pane shows.
  assert.equal(hub.snapshot().connection.message, 'cursor ready')
})

test('a switch whose provider fails to come up puts the pane back on the source provider', async () => {
  const { hub, antigravity, events } = build('gpt-5.6-sol')
  // Never seen on this workspace: the pick cannot be validated from a cache, so the provider is asked.
  antigravity.models = []
  antigravity.connectionState = 'starting'
  antigravity.selectModel = async () => { throw new Error('agy is not signed in') }
  await hub.start()
  events.length = 0

  await assert.rejects(hub.selectModel('agy:gemini-3.8-flash'), /not signed in/)
  assert.equal(hub.activeProvider, 'codex')
  const last = events.at(-1)
  assert.equal(last?.type, 'replace')
  if (last?.type === 'replace') assert.equal(last.snapshot.provider, 'codex')
})

test('the snapshot is the active provider with every catalog merged', () => {
  const { hub } = build()
  const snapshot = hub.snapshot()
  assert.equal(snapshot.provider, 'codex')
  assert.deepEqual(snapshot.models.map((entry) => entry.id), [
    'gpt-5.6-sol', 'claude:opus[1m]', 'agy:gemini-3.8-flash', 'cursor:claude-opus-5[effort=high]'
  ])
})

test('selecting the other provider switches the pane after that provider accepts the model', async () => {
  const { hub, codex, claude, events } = build()
  await hub.selectModel('claude:opus[1m]')
  assert.deepEqual(claude.calls, ['newThread'])
  assert.equal(hub.activeProvider, 'claude')
  assert.equal(events.at(-1)?.type, 'replace')
  await hub.send('hi', [])
  assert.deepEqual(claude.calls, ['newThread', 'start:true', 'send:hi'])
  assert.deepEqual(codex.calls, ['stop'])
  await hub.selectModel('claude:opus[1m]')
  assert.equal(hub.activeProvider, 'claude')
})

test('a model switch carries the chat instead of reopening the destination\u2019s last one', async () => {
  const { hub, codex, claude, events } = build()
  codex.items = [
    { type: 'user', id: 'user-1', turnId: 't1', text: 'Hello from the original chat' },
    { type: 'assistant', id: 'a-1', turnId: 't1', text: 'An answer', phase: 'final_answer', streaming: false }
  ]
  claude.items = [{ type: 'user', id: 'old-1', turnId: 'x', text: 'An unrelated chat Claude had open' }]
  await hub.selectModel('claude:opus[1m]')
  assert.equal(hub.activeProvider, 'claude')
  assert.deepEqual(claude.calls, ['continue:codex'])
  assert.equal(claude.continued?.threadId, 'codex-thread')
  assert.match(claude.continued?.text ?? '', /Hello from the original chat/)
  const replaced = events.at(-1)
  assert.equal(replaced?.type, 'replace')
  if (replaced?.type !== 'replace') return
  // The pane keeps showing the conversation it was in; Claude's old chat stays in history.
  assert.deepEqual(replaced.snapshot.items, codex.items)
})

test('the carried chat survives a re-read and the destination\u2019s own updates', async () => {
  const { hub, codex, claude } = build()
  codex.items = [{ type: 'user', id: 'user-1', turnId: 't1', text: 'Hello from the original chat' }]
  await hub.selectModel('claude:opus[1m]')
  // Not just the one replace event: any later snapshot the pane reads shows the carried chat.
  assert.deepEqual(hub.snapshot().items.map((item) => item.id), ['user-1'])
  claude.items = [{ type: 'user', id: 'claude-1', turnId: 'c1', text: 'The next message' }]
  claude.replace()
  assert.deepEqual(hub.snapshot().items.map((item) => item.id), ['user-1', 'claude-1'])
  // A page that has not reached the start of Claude's own transcript yet leaves it out.
  claude.hasEarlier = true
  assert.deepEqual(hub.snapshot({ limit: 1 }).items.map((item) => item.id), ['claude-1'])
  claude.hasEarlier = false
  assert.deepEqual(hub.snapshot({ limit: 5 }).items.map((item) => item.id), ['user-1', 'claude-1'])
})

test('leaving the conversation drops the carried chat', async () => {
  const started = build()
  started.codex.items = [{ type: 'user', id: 'user-1', turnId: 't1', text: 'Hello' }]
  await started.hub.selectModel('claude:opus[1m]')
  await started.hub.newThread()
  assert.deepEqual(started.hub.snapshot().items, [])

  const opened = build()
  opened.codex.items = [{ type: 'user', id: 'user-1', turnId: 't1', text: 'Hello' }]
  await opened.hub.selectModel('claude:opus[1m]')
  opened.claude.items = [{ type: 'user', id: 'other-1', turnId: 'o1', text: 'Another chat' }]
  await opened.hub.openThread('claude:s1')
  assert.deepEqual(opened.hub.snapshot().items.map((item) => item.id), ['other-1'])

  const archived = build()
  archived.codex.items = [{ type: 'user', id: 'user-1', turnId: 't1', text: 'Hello' }]
  await archived.hub.selectModel('claude:opus[1m]')
  // Claude clearing itself (an archive, a reset) ends the conversation the carried chat is part of.
  archived.claude.items = []
  archived.claude.threadId = null
  archived.claude.replace()
  assert.deepEqual(archived.hub.snapshot().items, [])
})

test('switching with nothing to carry starts the destination blank, keeping an undelivered digest', async () => {
  const { hub, claude, settings } = build()
  const pending = {
    sourcePaneId: null, sourceThreadId: 'codex-thread', sourceProvider: 'codex' as const,
    sourceTitle: 'Earlier chat', handoff: 'digest', createdAt: 1
  }
  settings.saved.chatContinuation = pending
  claude.items = [{ type: 'user', id: 'old-1', turnId: 'x', text: 'An unrelated chat Claude had open' }]
  await hub.selectModel('claude:opus[1m]')
  assert.deepEqual(claude.calls, ['newThread'])
  assert.deepEqual(settings.saved.chatContinuation, pending)
  assert.deepEqual(hub.snapshot().items, [])
})

test('opening another provider\u2019s thread from history shows that thread', async () => {
  const { hub, codex, claude } = build()
  codex.items = [{ type: 'user', id: 'user-1', turnId: 't1', text: 'Hello from the original chat' }]
  claude.items = [{ type: 'user', id: 'old-1', turnId: 'x', text: 'The chat being opened' }]
  await hub.openThread('claude:s1')
  assert.deepEqual(claude.calls, ['openThread:claude:s1'])
  assert.deepEqual(hub.snapshot().items, claude.items)
})

test('a running turn blocks switching providers', async () => {
  const { hub, codex } = build()
  codex.activeTurnId = 'turn'
  await assert.rejects(hub.selectModel('claude:opus[1m]'), /Stop the current turn/)
  assert.equal(hub.activeProvider, 'codex')
})

test('threads merge newest first and route by id; one failing provider hides only its threads', async () => {
  const { hub, codex, claude, antigravity, cursor } = build()
  codex.threads = [{ id: 'c1', title: 'Codex', preview: '', createdAt: 1, updatedAt: 5 }]
  claude.threads = [{ id: 'claude:s1', title: 'Claude', preview: '', createdAt: 1, updatedAt: 9 }]
  assert.deepEqual((await hub.listThreads()).map((thread) => thread.id), ['claude:s1', 'c1'])
  claude.failThreads = true
  assert.deepEqual((await hub.listThreads()).map((thread) => thread.id), ['c1'])
  codex.failThreads = true
  antigravity.failThreads = true
  cursor.failThreads = true
  await assert.rejects(hub.listThreads(), /down/)
  claude.failThreads = false
  await hub.openThread('claude:s1')
  assert.equal(hub.activeProvider, 'claude')
  assert.deepEqual(claude.calls, ['openThread:claude:s1'])
  await hub.archiveThread('c1')
  assert.deepEqual(codex.calls, ['stop', 'archive:c1'])
})

test('connection events from either provider re-describe the active one with merged models', () => {
  const { hub, claude, events } = build()
  claude.emit('event', { type: 'connection', provider: 'claude', connection: { state: 'ready', message: 'x' }, account: null, models: [], selectedModel: null, selectedReasoningEffort: null })
  const event = events.at(-1)
  assert.equal(event?.type, 'connection')
  if (event?.type !== 'connection') return
  assert.equal(event.provider, 'codex')
  assert.equal(event.connection.message, 'codex ready')
  assert.equal(event.models.length, 4)
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

test('compactConversation routes to the active provider when supported', async () => {
  const { hub, antigravity, codex } = build('agy:gemini-3.8-flash')
  await hub.compactConversation()
  assert.deepEqual(antigravity.calls, ['compactConversation'])
  assert.deepEqual(codex.calls, [])
  await hub.selectModel('gpt-5.6-sol')
  await assert.rejects(hub.compactConversation(), /does not support compaction/)
})
