import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { ChatAttachment, ChatEvent, ChatHistoryWindow, ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import type { AppSettings } from '../../shared/types.js'
import { DEFAULT_APP_SETTINGS, type AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { ChatPeerManager } from './peer-manager.js'
import { traceLog } from '../trace/trace-log.js'

class MemorySettings implements AppSettingsAccess {
  constructor(private value: AppSettings) {}
  get(): AppSettings { return structuredClone(this.value) }
  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.value = { ...this.value, ...structuredClone(patch) }
    return this.get()
  }
}

class FakeSurface extends EventEmitter implements ChatSurface {
  calls: string[] = []
  snapshotCalls = 0
  state: ChatSnapshot

  constructor(modelId: string | null) {
    super()
    this.state = {
      provider: modelId?.startsWith('claude:') ? 'claude' : 'codex',
      connection: { state: 'ready', message: 'ready' },
      account: null,
      models: [],
      selectedModel: modelId,
      selectedReasoningEffort: null,
      cwd: '/workspace',
      threadId: null,
      threadName: null,
      activeTurnId: null,
      contextUsage: null,
      planUsage: null,
      turnContext: null,
      items: []
    }
  }

  snapshot(window?: ChatHistoryWindow): ChatSnapshot {
    this.snapshotCalls += 1
    if (!window) return structuredClone(this.state)
    const end = window.beforeItemId ? this.state.items.findIndex((item) => item.id === window.beforeItemId) : this.state.items.length
    if (end < 0) throw new Error('History changed')
    const start = Math.max(0, end - window.limit)
    return structuredClone({ ...this.state, items: this.state.items.slice(start, end), history: { hasEarlier: start > 0 } })
  }
  async start(): Promise<void> { this.calls.push('start') }
  stop(): void { this.calls.push('stop') }
  async send(text: string, _attachments: ChatAttachment[]): Promise<void> {
    this.calls.push(`send:${text}`)
    this.state.activeTurnId = `turn:${text}`
    this.emit('event', { type: 'turn', turnId: this.state.activeTurnId } satisfies ChatEvent)
  }
  async interrupt(): Promise<void> { this.calls.push('interrupt'); this.state.activeTurnId = null }
  async selectModel(modelId: string): Promise<void> { this.calls.push(`model:${modelId}`); this.state.selectedModel = modelId }
  async selectReasoningEffort(effort: string): Promise<void> { this.calls.push(`effort:${effort}`) }
  async refreshPlanUsage(): Promise<void> { this.calls.push('refreshPlanUsage') }
  async listThreads(): Promise<[]> { this.calls.push('listThreads'); return [] }
  async readThread(threadId: string): Promise<ChatThreadContent> {
    this.calls.push(`read:${threadId}`)
    return {
      threadId,
      threadName: 'Saved chat',
      items: [
        { type: 'user', id: 'saved-user', turnId: 'saved-turn', text: 'Original request' },
        { type: 'assistant', id: 'saved-answer', turnId: 'saved-turn', text: 'Original answer', phase: 'final_answer', streaming: false }
      ]
    }
  }
  async newThread(): Promise<void> { this.calls.push('newThread') }
  async continueInNewThread(): Promise<void> { this.calls.push('continue') }
  async openThread(threadId: string): Promise<void> { this.calls.push(`open:${threadId}`) }
  async archiveThread(threadId: string): Promise<void> { this.calls.push(`archive:${threadId}`) }
  async beginLogin(): Promise<string | null> { return null }
}

function harness(idleParkMs?: number): { manager: ChatPeerManager; surfaces: FakeSurface[]; settings: MemorySettings } {
  const paneId = 'pane-a'
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: [{
      paneId,
      provider: 'codex',
      threadId: null,
      codexThreadId: null,
      claudeSessionId: null,
      modelId: 'gpt',
      reasoningEffort: null
    }],
    chatSelectedPaneId: paneId
  })
  const surfaces: FakeSurface[] = []
  const manager = new ChatPeerManager(settings, (_peerSettings, modelId) => {
    const surface = new FakeSurface(modelId)
    surfaces.push(surface)
    return surface
  }, idleParkMs)
  return { manager, surfaces, settings }
}

test('send captures provider dispatch and first text through the pane event path', async (t) => {
  traceLog.clear()
  const { manager, surfaces } = harness()
  t.after(() => { manager.stop(); traceLog.clear() })
  const paneId = manager.snapshot().selectedPaneId
  surfaces[0]!.send = async () => {
    traceLog.record({ paneId, provider: 'codex', turnId: null }, {
      kind: 'raw', label: 'codex.out', direction: 'out', summary: 'turn/start #1', detail: {}
    })
    surfaces[0]!.emit('event', { type: 'turn', turnId: 't' } satisfies ChatEvent)
    surfaces[0]!.emit('event', { type: 'item', item: {
      type: 'assistant', id: 'a', turnId: 't', text: 'Hello', phase: 'commentary', streaming: true
    } } satisfies ChatEvent)
  }
  await manager.send(paneId, 'Hello', [])
  const timing = traceLog.snapshot().entries.find((entry) => entry.label === 'response.first_text')
  assert.equal(timing?.paneId, paneId)
  assert.equal(timing?.turnId, 't')
  assert.ok(timing!.durationMs! >= 0)
})

test('operations on one pane run in order instead of interleaving', async (t) => {
  const { manager, surfaces } = harness()
  t.after(() => manager.stop())
  const paneId = manager.snapshot().selectedPaneId
  const surface = surfaces[0]!
  let release: (() => void) | null = null
  const held = new Promise<void>((resolve) => { release = resolve })
  surface.selectModel = async (modelId) => { await held; surface.calls.push(`model:${modelId}`) }
  // Issued together, as a tool batch does: unserialized, the send runs while the switch waits,
  // starting a turn on the provider the pane is leaving.
  const switching = manager.selectModel(paneId, 'claude:opus')
  const sending = manager.send(paneId, 'Hello', [])
  release!()
  await Promise.all([switching, sending])
  assert.deepEqual(surface.calls.filter((call) => /^(model|send):/.test(call)), ['model:claude:opus', 'send:Hello'])
})

test('startup and workspace history only wake the selected persisted pane', async () => {
  const paneA = 'pane-a'
  const paneB = 'pane-b'
  const records = [paneA, paneB].map((paneId) => ({
    paneId,
    provider: 'codex' as const,
    threadId: null,
    codexThreadId: null,
    claudeSessionId: null,
    modelId: 'gpt',
    reasoningEffort: null
  }))
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: records,
    chatSelectedPaneId: paneB
  })
  const surfaces: FakeSurface[] = []
  const manager = new ChatPeerManager(settings, (_peerSettings, modelId) => {
    const surface = new FakeSurface(modelId)
    surfaces.push(surface)
    return surface
  })

  await manager.start()
  await manager.listThreads()

  assert.deepEqual(surfaces[0]!.calls, [])
  assert.deepEqual(surfaces[1]!.calls, ['start', 'listThreads'])
})

test('new chat keeps a running peer alive and selects an independent surface', async () => {
  const { manager, surfaces } = harness()
  await manager.send('pane-a', 'first', [])
  const paneB = await manager.newPeer()
  assert.notEqual(paneB, 'pane-a')
  assert.equal(manager.snapshot().selectedPaneId, paneB)
  assert.equal(manager.snapshot().peers.length, 2)
  assert.equal(surfaces[0]!.state.activeTurnId, 'turn:first')
  await manager.send(paneB, 'second', [])
  assert.equal(surfaces[1]!.state.activeTurnId, 'turn:second')
})

test('continue creates an independent target-model pane and persists source lineage plus handoff', async () => {
  const { manager, surfaces, settings } = harness()
  surfaces[0]!.state.threadId = 'thread-a'
  surfaces[0]!.state.threadName = 'Fix continuation'
  surfaces[0]!.state.items = [
    { type: 'user', id: 'user-a', turnId: 'turn-a', text: 'Keep this context' },
    { type: 'assistant', id: 'answer-a', turnId: 'turn-a', text: 'Context kept', phase: 'final_answer', streaming: false }
  ]

  const target = await manager.continueInNewPeer(
    { paneId: 'pane-a', threadId: 'thread-a' },
    'claude:opus'
  )

  assert.notEqual(target, 'pane-a')
  assert.equal(manager.snapshot().selectedPaneId, target)
  assert.equal(manager.snapshot().peers.length, 2)
  assert.equal(surfaces[0]!.state.threadId, 'thread-a')
  assert.equal(surfaces[0]!.calls.includes('continue'), false)
  assert.equal(surfaces[1]!.state.selectedModel, 'claude:opus')
  const record = settings.get().chatPeers.find((peer) => peer.paneId === target)!
  assert.equal(record.continuation?.sourcePaneId, 'pane-a')
  assert.equal(record.continuation?.sourceThreadId, 'thread-a')
  assert.equal(record.continuation?.sourceTitle, 'Fix continuation')
  assert.match(record.continuation?.handoff ?? '', /User: Keep this context/)
})

test('continue reads a history-only source without opening it in the selected pane', async () => {
  const { manager, surfaces, settings } = harness()
  const target = await manager.continueInNewPeer(
    { paneId: null, threadId: 'saved-thread' },
    'gpt-5'
  )

  assert.deepEqual(surfaces[0]!.calls, ['start', 'read:saved-thread'])
  assert.equal(surfaces[0]!.calls.some((call) => call.startsWith('open:')), false)
  const record = settings.get().chatPeers.find((peer) => peer.paneId === target)!
  assert.equal(record.continuation?.sourceThreadId, 'saved-thread')
  assert.equal(record.continuation?.sourceTitle, 'Saved chat')
})

test('switching away before the first send keeps a pending continuation pane', async () => {
  const { manager, surfaces } = harness()
  surfaces[0]!.state.items = [{ type: 'user', id: 'user-a', turnId: null, text: 'Keep me' }]
  const target = await manager.continueInNewPeer({ paneId: 'pane-a', threadId: null }, 'gpt')

  await manager.selectPane('pane-a')

  assert.equal(manager.snapshot().peers.some((peer) => peer.paneId === target), true)
  assert.equal(surfaces[1]!.calls.includes('stop'), false)
})

test('selection and interruption target one pane without stopping its peer', async () => {
  const { manager, surfaces } = harness()
  const paneB = await manager.newPeer()
  await manager.send('pane-a', 'a', [])
  await manager.send(paneB, 'b', [])
  await manager.selectPane('pane-a')
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  await manager.interrupt('pane-a')
  assert.equal(surfaces[0]!.state.activeTurnId, null)
  assert.equal(surfaces[1]!.state.activeTurnId, 'turn:b')
  assert.equal(surfaces[1]!.calls.includes('interrupt'), false)
})

test('peer awareness exposes child subagent activity without duplicating the caller', () => {
  const { manager, surfaces } = harness()
  surfaces[0]!.state.items = [{
    type: 'tool',
    id: 'sub-1',
    turnId: 'turn',
    label: 'Subagent',
    detail: 'Review the runtime',
    status: 'inProgress'
  }]
  const visible = manager.listReadable('pane-a')
  assert.equal(visible.length, 1)
  assert.equal(visible[0]!.kind, 'subagent')
  assert.equal(visible[0]!.parentPaneId, 'pane-a')
  assert.equal(visible[0]!.running, true)
  const read = manager.readReadable(visible[0]!.paneId, 'pane-a')
  assert.equal(read?.items[0]?.id, 'sub-1')
})

test('closePeer stops surface and removes pane, selecting remaining pane', async () => {
  const { manager, surfaces } = harness()
  const paneB = await manager.newPeer()
  assert.equal(manager.snapshot().peers.length, 2)
  assert.equal(manager.snapshot().selectedPaneId, paneB)

  await manager.closePeer(paneB)
  assert.equal(manager.snapshot().peers.length, 1)
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.ok(surfaces[1]!.calls.includes('stop'))
})

test('switching away from an empty new chat discards it so it does not linger', async () => {
  const { manager, surfaces } = harness()
  await manager.send('pane-a', 'hello', [])
  const paneB = await manager.newPeer()
  assert.equal(manager.snapshot().peers.length, 2)
  assert.equal(manager.snapshot().selectedPaneId, paneB)

  // Switching back to pane-a without sending anything in paneB should discard empty paneB
  await manager.selectPane('pane-a')
  assert.equal(manager.snapshot().peers.length, 1)
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.ok(surfaces[1]!.calls.includes('stop'))
})

test('unfocused idle panes park after the grace period and wake when selected', async () => {
  const { manager, surfaces } = harness(5)
  await manager.start()
  surfaces[0]!.state.items = [{ type: 'user', id: 'user-a', turnId: null, text: 'keep me' }]

  const paneB = await manager.newPeer()
  surfaces[1]!.state.items = [{ type: 'user', id: 'user-b', turnId: null, text: 'keep me too' }]
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.deepEqual(surfaces[0]!.calls, ['start', 'stop'])
  await manager.selectPane('pane-a')
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.deepEqual(surfaces[0]!.calls, ['start', 'stop', 'start'])
  assert.equal(paneB, manager.snapshot().peers.find((peer) => peer.paneId === paneB)?.paneId)
})

test('a burst of drawer refreshes scans the thread catalog once, and archiving reopens it', async () => {
  const { manager, surfaces } = harness()
  const scans = (): number => surfaces[0]!.calls.filter((call) => call === 'listThreads').length

  await Promise.all([manager.listThreads(), manager.listThreads()])
  await manager.listThreads()
  assert.equal(scans(), 1)

  await manager.archiveThread('claude:gone')
  await manager.listThreads()
  assert.equal(scans(), 2)
})

test('selecting a parked pane paints it before its runtime is back', async () => {
  const { manager, surfaces } = harness(5)
  await manager.start()
  surfaces[0]!.state.items = [{ type: 'user', id: 'user-a', turnId: null, text: 'keep me' }]
  const paneB = await manager.newPeer()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(surfaces[0]!.calls, ['start', 'stop'])

  let release = (): void => {}
  const restart = new Promise<void>((resolve) => { release = () => resolve() })
  surfaces[0]!.start = () => { surfaces[0]!.calls.push('start'); return restart }
  const events: ChatWorkspaceEvent[] = []
  manager.on('event', (event: ChatWorkspaceEvent) => events.push(event))

  await manager.selectPane('pane-a')

  // The workspace is already on pane-a while its surface is still starting.
  assert.equal(events.some((event) => event.type === 'workspace' && event.snapshot.selectedPaneId === 'pane-a'), true)
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.equal(surfaces[0]!.calls.at(-1), 'start')
  // The empty pane it left is still discarded, and its record with it.
  assert.equal(manager.snapshot().peers.some((peer) => peer.paneId === paneB), false)
  release()
  await restart
})

test('an unfocused running pane parks only after its turn finishes', async () => {
  const { manager, surfaces } = harness(5)
  await manager.start()
  await manager.send('pane-a', 'background work', [])
  await manager.newPeer()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(surfaces[0]!.calls.includes('stop'), false)

  surfaces[0]!.state.activeTurnId = null
  surfaces[0]!.emit('event', { type: 'turn', turnId: null } satisfies ChatEvent)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(surfaces[0]!.calls.includes('stop'), true)
})

test('branching at a response excludes later messages and rejects unknown endpoints', async () => {
  const { manager, surfaces, settings } = harness()
  surfaces[0]!.state.items = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Original question' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'Original answer', phase: 'final_answer', streaming: false },
    { type: 'user', id: 'u2', turnId: 't2', text: 'Later question must be excluded' }
  ]
  await assert.rejects(manager.continueInNewPeer({
    paneId: 'pane-a', threadId: null, throughItemId: 'missing'
  }, null), /completed response/)
  const target = await manager.continueInNewPeer({
    paneId: 'pane-a', threadId: null, throughItemId: 'a1'
  }, null)
  const handoff = settings.get().chatPeers.find((peer) => peer.paneId === target)?.continuation?.handoff ?? ''
  assert.match(handoff, /Original answer/)
  assert.doesNotMatch(handoff, /Later question/)
  assert.equal(surfaces[0]!.state.items.length, 3)
})

test('a pane persists its title and activity time so a parked pane keeps its name after relaunch', async () => {
  const { manager, surfaces, settings } = harness()
  const surface = surfaces[0]!
  surface.state.items = [{ type: 'user', id: 'u1', turnId: 't1', text: 'Fix the sidebar' }]
  surface.emit('event', { type: 'item', item: surface.state.items[0]! } satisfies ChatEvent)
  await new Promise((resolve) => setImmediate(resolve))

  const record = settings.get().chatPeers.find((peer) => peer.paneId === 'pane-a')!
  assert.equal(record.title, 'Fix the sidebar')
  assert.ok((record.updatedAt ?? 0) > 0)
  assert.equal(manager.snapshot().peers[0]!.title, 'Fix the sidebar')
})

test('streaming pane events update the drawer without cloning the transcript', () => {
  const { manager, surfaces } = harness()
  const surface = surfaces[0]!
  surface.state.items = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'A long request' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'Answer so far', phase: null, streaming: true }
  ]
  const before = surface.snapshotCalls
  surface.emit('event', { type: 'item', item: surface.state.items[1]! } satisfies ChatEvent)
  surface.emit('event', { type: 'itemDelta', itemId: 'a1', field: 'text', delta: ' and more' } satisfies ChatEvent)
  assert.equal(surface.snapshotCalls, before)
  assert.equal(manager.snapshot().peers[0]!.preview, 'Answer so far and more')
  assert.equal(surface.snapshotCalls, before + 1)
})

test('renderer replacement and page requests are bounded while peer reads keep history', () => {
  const { manager, surfaces } = harness()
  const surface = surfaces[0]!
  surface.state.items = Array.from({ length: 500 }, (_, i) => ({ type: 'user', id: `u${i}`, turnId: null, text: `message ${i}` }))
  const events: ChatWorkspaceEvent[] = []
  manager.on('event', (event: ChatWorkspaceEvent) => events.push(event))
  surface.emit('event', { type: 'replace', snapshot: surface.snapshot() } satisfies ChatEvent)
  const replacement = events.find((event) => event.type === 'pane' && event.event.type === 'replace')
  assert.ok(replacement?.type === 'pane' && replacement.event.type === 'replace')
  assert.equal(replacement.event.snapshot.items.length, 200)
  assert.equal(replacement.event.snapshot.items[0]?.id, 'u300')
  assert.equal(manager.snapshot({ limit: 200 }).selected.items.length, 200)
  assert.equal(manager.paneSnapshot('pane-a')!.items.length, 500)
  assert.equal(manager.readHistoryPage('pane-a', null, 'u300').items[0]?.id, 'u100')
  assert.throws(() => manager.readHistoryPage('pane-a', 'another-thread', 'u300'), /chat changed/)
  manager.stop()
})

test('a persisted pane that has not been woken still shows its saved title and thread', () => {
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: [{
      paneId: 'pane-cold',
      provider: 'claude',
      threadId: 'claude:s1',
      codexThreadId: null,
      claudeSessionId: 's1',
      modelId: 'claude:opus',
      reasoningEffort: null,
      title: 'Agent sidebar bugs',
      updatedAt: 1234
    }],
    chatSelectedPaneId: 'pane-cold'
  })
  const manager = new ChatPeerManager(settings, (_peerSettings, modelId) => new FakeSurface(modelId))
  const [peer] = manager.snapshot().peers
  assert.equal(peer!.title, 'Agent sidebar bugs')
  assert.equal(peer!.threadId, 'claude:s1')
  assert.equal(peer!.updatedAt, 1234)
})

function manyPanes(count: number): AppSettings['chatPeers'] {
  return Array.from({ length: count }, (_, index) => ({
    paneId: `pane-${index}`,
    provider: 'codex' as const,
    threadId: `thread-${index}`,
    codexThreadId: `thread-${index}`,
    claudeSessionId: null,
    modelId: 'gpt',
    reasoningEffort: null,
    updatedAt: index + 1
  }))
}

test('startup retires the least recently active panes down to the open-pane cap', async () => {
  const records = manyPanes(12)
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: records,
    chatSelectedPaneId: 'pane-0'
  })
  const manager = new ChatPeerManager(settings, (_peerSettings, modelId) => new FakeSurface(modelId))

  await manager.start()

  const kept = settings.get().chatPeers.map((peer) => peer.paneId)
  assert.equal(kept.length, 8)
  // The selected pane survives even though it is the oldest; the rest keep the newest activity.
  assert.deepEqual(kept, ['pane-0', 'pane-5', 'pane-6', 'pane-7', 'pane-8', 'pane-9', 'pane-10', 'pane-11'])
  assert.deepEqual(manager.snapshot().peers.map((peer) => peer.paneId), kept)
})

test('retirement never closes a running pane or one holding an undelivered handoff', async () => {
  const records = manyPanes(10)
  records[1] = {
    ...records[1]!,
    continuation: {
      sourcePaneId: null,
      sourceThreadId: 'source',
      sourceProvider: 'codex',
      sourceTitle: 'Source chat',
      handoff: 'digest',
      createdAt: 1
    }
  }
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: records,
    chatSelectedPaneId: 'pane-9'
  })
  const surfaces = new Map<string | null, FakeSurface>()
  const manager = new ChatPeerManager(settings, (peerSettings, modelId) => {
    const surface = new FakeSurface(modelId)
    surfaces.set(peerSettings.paneId, surface)
    return surface
  })
  surfaces.get('pane-0')!.state.activeTurnId = 'turn-live'

  await manager.start()

  const kept = settings.get().chatPeers.map((peer) => peer.paneId)
  assert.equal(kept.length, 8)
  assert.ok(kept.includes('pane-0'), 'a pane mid-turn stays open')
  assert.ok(kept.includes('pane-1'), 'a pending continuation stays open')
  assert.ok(kept.includes('pane-9'), 'the selected pane stays open')
  assert.equal(kept.includes('pane-2'), false)
})

test('a new chat retires the oldest pane instead of growing the workspace', async () => {
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: manyPanes(8),
    chatSelectedPaneId: 'pane-7'
  })
  const manager = new ChatPeerManager(settings, (_peerSettings, modelId) => new FakeSurface(modelId))

  const fresh = await manager.newPeer()

  const kept = settings.get().chatPeers.map((peer) => peer.paneId)
  assert.equal(kept.length, 8)
  assert.ok(kept.includes(fresh))
  assert.equal(kept.includes('pane-0'), false)
})
