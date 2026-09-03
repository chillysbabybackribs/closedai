import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { ChatAttachment, ChatEvent, ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
import type { AppSettings } from '../../shared/types.js'
import { DEFAULT_APP_SETTINGS, type AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { ChatPeerManager } from './peer-manager.js'

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
      turnContext: null,
      items: []
    }
  }

  snapshot(): ChatSnapshot { return structuredClone(this.state) }
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
