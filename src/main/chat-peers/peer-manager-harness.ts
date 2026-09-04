import { EventEmitter } from 'node:events'
import type { ChatAttachment, ChatEvent, ChatHistoryWindow, ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
import type { AppSettings } from '../../shared/types.js'
import { DEFAULT_APP_SETTINGS, type AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { ChatPeerManager } from './peer-manager.js'

// Test doubles shared by the peer-manager test files: an in-memory settings store, a surface that
// records its calls and emits events on demand, and a one-pane workspace built from both.

export class MemorySettings implements AppSettingsAccess {
  constructor(private value: AppSettings) {}
  get(): AppSettings { return structuredClone(this.value) }
  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.value = { ...this.value, ...structuredClone(patch) }
    return this.get()
  }
}

export class FakeSurface extends EventEmitter implements ChatSurface {
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

export function harness(idleParkMs?: number): { manager: ChatPeerManager; surfaces: FakeSurface[]; settings: MemorySettings } {
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
