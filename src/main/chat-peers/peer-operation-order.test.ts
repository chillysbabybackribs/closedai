import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import type { ChatAttachment, ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
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

class Surface extends EventEmitter implements ChatSurface {
  calls: string[] = []
  /** Released by the test: the model switch waits on it so an unserialized send can overtake. */
  release!: () => void
  private readonly held = new Promise<void>((resolve) => { this.release = resolve })

  constructor(private readonly modelId: string | null) { super() }
  snapshot(): ChatSnapshot {
    return {
      provider: 'codex', connection: { state: 'ready', message: 'ready' }, account: null,
      models: [], selectedModel: this.modelId, selectedReasoningEffort: null, cwd: '/workspace',
      threadId: null, threadName: null, activeTurnId: null, contextUsage: null, planUsage: null,
      turnContext: null, items: []
    }
  }
  async start(): Promise<void> {}
  async refreshPlanUsage(): Promise<void> {}
  stop(): void {}
  async send(text: string, _attachments: ChatAttachment[]): Promise<void> { this.calls.push(`send:${text}`) }
  async interrupt(): Promise<void> {}
  async selectModel(modelId: string): Promise<void> { await this.held; this.calls.push(`model:${modelId}`) }
  async selectReasoningEffort(_effort: string): Promise<void> {}
  async listThreads(): Promise<[]> { return [] }
  async readThread(threadId: string): Promise<ChatThreadContent> { return { threadId, threadName: null, items: [] } }
  async newThread(): Promise<void> {}
  async continueInNewThread(): Promise<void> {}
  async openThread(_threadId: string): Promise<void> {}
  async archiveThread(_threadId: string): Promise<void> {}
  async beginLogin(): Promise<string | null> { return null }
}

test('operations on one pane run in order instead of interleaving', async (t) => {
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: [{
      paneId: 'pane-a', provider: 'codex', threadId: null, codexThreadId: null, claudeSessionId: null,
      modelId: 'gpt', reasoningEffort: null
    }],
    chatSelectedPaneId: 'pane-a'
  })
  const surfaces: Surface[] = []
  const manager = new ChatPeerManager(settings, (_settings, modelId) => {
    const surface = new Surface(modelId)
    surfaces.push(surface)
    return surface
  })
  t.after(() => manager.stop())

  // Issued together, as a tool batch does. Unserialized, the send runs while the switch is still
  // waiting and starts its turn on the provider the pane is in the middle of leaving.
  const switching = manager.selectModel('pane-a', 'claude:opus')
  const sending = manager.send('pane-a', 'Hello', [])
  const surface = surfaces[0]!
  surface.release()
  await Promise.all([switching, sending])
  assert.deepEqual(surface.calls, ['model:claude:opus', 'send:Hello'])
})
