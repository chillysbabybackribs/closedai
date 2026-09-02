import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { ChatAttachment, ChatEvent, ChatSnapshot } from '../../shared/chat.js'
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
  async selectModel(modelId: string): Promise<void> { this.calls.push(`model:${modelId}`) }
  async selectReasoningEffort(effort: string): Promise<void> { this.calls.push(`effort:${effort}`) }
  async listThreads(): Promise<[]> { return [] }
  async newThread(): Promise<void> { this.calls.push('newThread') }
  async continueInNewThread(): Promise<void> { this.calls.push('continue') }
  async openThread(threadId: string): Promise<void> { this.calls.push(`open:${threadId}`) }
  async archiveThread(threadId: string): Promise<void> { this.calls.push(`archive:${threadId}`) }
  async beginLogin(): Promise<string | null> { return null }
}

function harness(): { manager: ChatPeerManager; surfaces: FakeSurface[] } {
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
  })
  return { manager, surfaces }
}

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
