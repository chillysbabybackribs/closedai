import { EventEmitter } from 'node:events'
import type { ChatAttachment, ChatEvent, ChatHistoryWindow, ChatSnapshot, ChatThreadContent, ChatThreadSummary } from '../../shared/chat.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import { chatProviderOfId } from '../../shared/chat-providers.js'
import type { AppSettings } from '../../shared/types.js'
import { DEFAULT_APP_SETTINGS, type AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { ChatStore } from '../chat-store/chat-store.js'
import type { ChatTranscriptCache } from '../chat-store/chat-transcript-cache.js'
import { ChatPeerManager } from './peer-manager.js'

// Test doubles shared by the peer-manager test files: an in-memory settings store, an in-memory
// chat store, a surface that records its calls and emits events on demand, and a one-chat
// workspace built from all three.

export const HARNESS_CWD = '/workspace'

/** A stored chat with the harness workspace and sensible defaults. */
export function chatRecord(id: string, modelId: string | null, extra: Partial<ChatRecord> = {}): ChatRecord {
  return {
    id,
    cwd: HARNESS_CWD,
    projectPath: HARNESS_CWD,
    provider: chatProviderOfId(modelId),
    modelId,
    reasoningEffort: null,
    codexThreadId: null,
    claudeSessionId: null,
    antigravityConversationId: null,
    cursorSessionId: null,
    threadId: null,
    title: null,
    pinnedAt: null,
    preview: '',
    createdAt: 1,
    updatedAt: 1,
    lastTurnEndedAt: null,
    messageSentAt: null,
    archived: false,
    continuation: null,
    checkpoint: null,
    parentChatId: null,
    ...extra
  }
}

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
      pausedTurnId: null,
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
  async listThreads(): Promise<ChatThreadSummary[]> { this.calls.push('listThreads'); return [] }
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
  async compactConversation(): Promise<void> { this.calls.push('compact') }
  async beginLogin(): Promise<string | null> { return null }
}

export type Harness = { manager: ChatPeerManager; surfaces: FakeSurface[]; settings: MemorySettings; store: ChatStore }

export function harness(idleParkMs?: number): Harness {
  return harnessWith([chatRecord('pane-a', 'gpt')], 'pane-a', idleParkMs)
}

/** A workspace holding the given chats, with `openIds` (default: all of them) attached and one selected. */
export function harnessWith(
  records: ChatRecord[],
  selected: string,
  idleParkMs?: number,
  openIds?: string[],
  transcripts?: ChatTranscriptCache
): Harness {
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatWorkspacePath: HARNESS_CWD,
    chatProjectPath: HARNESS_CWD,
    chatOpenIds: openIds ?? records.map((record) => record.id),
    chatSelectedPaneId: selected
  })
  const store = ChatStore.inMemory(records)
  const surfaces: FakeSurface[] = []
  const manager = new ChatPeerManager(settings, store, (_peerSettings, record) => {
    const surface = new FakeSurface(record.modelId)
    surfaces.push(surface)
    return surface
  }, idleParkMs, undefined, transcripts)
  return { manager, surfaces, settings, store }
}
