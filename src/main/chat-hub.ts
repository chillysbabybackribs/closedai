import { EventEmitter } from 'node:events'
import type {
  ChatAttachment,
  ChatEvent,
  ChatProvider,
  ChatSnapshot,
  ChatThreadContent,
  ChatThreadSummary
} from '../shared/chat.js'
import { CHAT_PROVIDERS, chatProviderOfId } from '../shared/chat-providers.js'
import type { ChatHistoryWindow } from '../shared/chat.js'
import type { AppSettingsAccess } from './app-settings-store.js'

// One chat pane, several providers. Each provider owns its own thread, transcript, and
// connection; the hub owns which one the pane shows, merges the model catalogs so the picker
// can switch providers from any state, and routes every call by the id it carries. Picking a
// model from another provider switches the pane to that provider's current thread (the old one
// stays in history), which keeps a thread bound to the backend that can actually continue it.

/** What the chat IPC drives: the hub, or a single provider in tests. */
export type ChatSurface = {
  snapshot(window?: ChatHistoryWindow): ChatSnapshot
  start(): Promise<void>
  stop(): void
  send(text: string, attachments: ChatAttachment[]): Promise<void>
  interrupt(): Promise<void>
  selectModel(modelId: string): Promise<void>
  selectReasoningEffort(effort: string): Promise<void>
  /** Re-read the account's plan usage; providers that cannot report it do nothing. */
  refreshPlanUsage(): Promise<void>
  listThreads(): Promise<ChatThreadSummary[]>
  readThread(threadId: string): Promise<ChatThreadContent>
  newThread(): Promise<void>
  continueInNewThread(): Promise<void>
  openThread(threadId: string): Promise<void>
  archiveThread(threadId: string): Promise<void>
  /** Begin a sign-in; resolves to a URL to open, or null when the provider signs in elsewhere. */
  beginLogin(): Promise<string | null>
  on(event: 'event', listener: (event: ChatEvent) => void): unknown
}

export type ChatProviderService = Omit<ChatSurface, 'beginLogin' | 'start'> & {
  start(options?: { warm?: boolean }): Promise<void>
}

export type ChatHubProviders = {
  codex: ChatProviderService & { beginChatGptLogin(): Promise<string> }
  claude: ChatProviderService
  antigravity: ChatProviderService
}

export class ChatHub extends EventEmitter implements ChatSurface {
  private active: ChatProvider
  /** Set by `stop`, so a background provider start that lands afterwards does not leave a process. */
  private stopped = false

  constructor(
    private readonly providers: ChatHubProviders,
    initialModelId: string | null,
    private readonly settings: AppSettingsAccess
  ) {
    super()
    this.active = chatProviderOfId(initialModelId)
    for (const name of CHAT_PROVIDERS) {
      providers[name].on('event', (event: ChatEvent) => this.onProviderEvent(name, event))
    }
  }

  get activeProvider(): ChatProvider {
    return this.active
  }

  snapshot(window?: ChatHistoryWindow): ChatSnapshot {
    return this.merge(this.current().snapshot(window))
  }

  /**
   * Every provider starts; only the active one stays warm (the CLI-backed ones close again).
   * Only the active one is waited for, though: the others exist to fill in the model picker,
   * and awaiting all three made opening a chat cost three CLI start-ups instead of one.
   */
  async start(): Promise<void> {
    this.stopped = false
    await this.providers[this.active].start({ warm: true })
      .catch((error: unknown) => console.warn(`[chat] ${this.active} start failed:`, error))
    for (const name of CHAT_PROVIDERS) {
      if (name === this.active) continue
      void this.providers[name].start({ warm: false })
        .then(() => { if (this.stopped) this.providers[name].stop() })
        .catch((error: unknown) => console.warn(`[chat] ${name} start failed:`, error))
    }
  }

  stop(): void {
    this.stopped = true
    for (const name of CHAT_PROVIDERS) this.providers[name].stop()
  }

  send(text: string, attachments: ChatAttachment[]): Promise<void> {
    return this.current().send(text, attachments)
  }

  interrupt(): Promise<void> {
    return this.current().interrupt()
  }

  async selectModel(modelId: string): Promise<void> {
    const target = chatProviderOfId(modelId)
    if (target === this.active) return this.current().selectModel(modelId)
    await this.switchTo(target, () => this.providers[target].selectModel(modelId))
  }

  selectReasoningEffort(effort: string): Promise<void> {
    return this.current().selectReasoningEffort(effort)
  }

  /** Every provider's threads, newest first; one provider being down hides only its threads. */
  refreshPlanUsage(): Promise<void> {
    return this.current().refreshPlanUsage()
  }

  async listThreads(): Promise<ChatThreadSummary[]> {
    const lists = await Promise.allSettled(CHAT_PROVIDERS.map((name) => this.providers[name].listThreads()))
    const threads = lists.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    if (lists.every((result) => result.status === 'rejected')) throw (lists[0] as PromiseRejectedResult).reason
    return threads.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  readThread(threadId: string): Promise<ChatThreadContent> {
    return this.providers[chatProviderOfId(threadId)].readThread(threadId)
  }

  newThread(): Promise<void> {
    return this.current().newThread()
  }

  continueInNewThread(): Promise<void> {
    return this.current().continueInNewThread()
  }

  async openThread(threadId: string): Promise<void> {
    const target = chatProviderOfId(threadId)
    if (target === this.active) return this.current().openThread(threadId)
    await this.switchTo(target, () => this.providers[target].openThread(threadId))
  }

  archiveThread(threadId: string): Promise<void> {
    return this.providers[chatProviderOfId(threadId)].archiveThread(threadId)
  }

  async beginLogin(): Promise<string | null> {
    if (this.active === 'codex') return this.providers.codex.beginChatGptLogin()
    // Claude Code and Antigravity sign in from their own CLIs; re-checking picks up a login
    // completed elsewhere.
    await this.current().start({ warm: true })
    return null
  }

  private current(): ChatProviderService {
    return this.providers[this.active]
  }

  /** Switch the pane to another provider after its own action succeeds; the old thread stays put. */
  private async switchTo(target: ChatProvider, action: () => Promise<void>): Promise<void> {
    if (this.current().snapshot({ limit: 0 }).activeTurnId) throw new Error('Stop the current turn before switching models')
    await action()
    this.active = target
    await this.persistActiveModel()
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  /**
   * The pane's saved model is what names its provider on the next launch, so a switch that came
   * from opening another provider's thread — where nothing went through the picker — has to
   * record the destination's model and effort too. Without it the pane reopens on the provider
   * it left. A failed write is reported rather than thrown: the switch itself already happened.
   */
  private async persistActiveModel(): Promise<void> {
    const { selectedModel, selectedReasoningEffort } = this.current().snapshot({ limit: 0 })
    if (!selectedModel) return
    const saved = this.settings.get()
    if (saved.chatModelId === selectedModel && saved.chatReasoningEffort === selectedReasoningEffort) return
    try {
      await this.settings.set({ chatModelId: selectedModel, chatReasoningEffort: selectedReasoningEffort })
    } catch (error) {
      console.warn('[chat] could not persist the pane model:', error instanceof Error ? error.message : String(error))
    }
  }

  private merge(snapshot: ChatSnapshot): ChatSnapshot {
    return { ...snapshot, models: this.models() }
  }

  private models(): ChatSnapshot['models'] {
    return CHAT_PROVIDERS.flatMap((name) => this.providers[name].snapshot({ limit: 0 }).models)
  }

  private onProviderEvent(source: ChatProvider, event: ChatEvent): void {
    if (event.type === 'connection') {
      // Any provider's catalog or connection changing re-describes the pane in terms of the
      // active provider, with every model merged in so the picker can offer the others.
      const active = this.current().snapshot({ limit: 0 })
      this.emitEvent({
        type: 'connection',
        provider: this.active,
        connection: active.connection,
        account: active.account,
        models: this.models(),
        selectedModel: active.selectedModel,
        selectedReasoningEffort: active.selectedReasoningEffort
      })
      return
    }
    if (source !== this.active) return
    if (event.type === 'replace') this.emitEvent({ type: 'replace', snapshot: this.merge(event.snapshot) })
    else this.emitEvent(event)
  }

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
  }
}
