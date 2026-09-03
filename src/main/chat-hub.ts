import { EventEmitter } from 'node:events'
import type {
  ChatAttachment,
  ChatEvent,
  ChatProvider,
  ChatSnapshot,
  ChatThreadContent,
  ChatThreadSummary,
  ChatTranscriptItem
} from '../shared/chat.js'
import { CHAT_PROVIDERS, chatProviderOfId } from '../shared/chat-providers.js'
import type { ChatHistoryWindow } from '../shared/chat.js'
import type { AppSettingsAccess } from './app-settings-store.js'
import { buildThreadHandoff, type ThreadHandoffSource } from './chat-context/thread-handoff.js'

// One chat pane, several providers. Each provider owns its own thread, transcript, and
// connection; the hub owns which one the pane shows, merges the model catalogs so the picker
// can switch providers from any state, and routes every call by the id it carries. Picking
// another provider's model stays in the pane's conversation: the destination leaves whatever
// chat it last had open and starts a fresh thread carrying a digest of this one, and the pane
// keeps showing the visible history. Opening another provider's thread from history is the
// other direction — there the destination's own thread is what the pane is asking for.

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

export type ChatProviderService = Omit<ChatSurface, 'beginLogin' | 'start' | 'continueInNewThread'> & {
  start(options?: { warm?: boolean }): Promise<void>
  /** With `from`, the new thread continues a chat this provider never held — a model switch. */
  continueInNewThread(from?: ThreadHandoffSource): Promise<void>
}

export type ChatHubProviders = {
  codex: ChatProviderService & { beginChatGptLogin(): Promise<string> }
  claude: ChatProviderService
  antigravity: ChatProviderService
}

/** The chat a model switch brought with it, shown above the destination provider's own messages. */
type CarriedHistory = { provider: ChatProvider; threadName: string | null; items: ChatTranscriptItem[] }

export class ChatHub extends EventEmitter implements ChatSurface {
  private active: ChatProvider
  /** Set by `stop`, so a background provider start that lands afterwards does not leave a process. */
  private stopped = false
  /** Cleared whenever the pane leaves that conversation; in memory only, like the pane itself. */
  private carriedHistory: CarriedHistory | null = null

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
    // The visible conversation, not just this provider's part of it, is what moves.
    const source = this.snapshot()
    await this.switchTo(source, target, async () => {
      await this.providers[target].selectModel(modelId)
      await this.carryConversation(source, target)
    })
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
    this.carriedHistory = null
    return this.current().newThread()
  }

  continueInNewThread(): Promise<void> {
    this.carriedHistory = null
    return this.current().continueInNewThread()
  }

  async openThread(threadId: string): Promise<void> {
    const target = chatProviderOfId(threadId)
    const source = this.snapshot()
    this.carriedHistory = null
    if (target === this.active) return this.current().openThread(threadId)
    await this.switchTo(source, target, () => this.providers[target].openThread(threadId))
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

  /** Switch the pane to another provider after its own action succeeds. */
  private async switchTo(
    source: ChatSnapshot,
    target: ChatProvider,
    action: () => Promise<void>,
    carried = false
  ): Promise<void> {
    if (source.activeTurnId) throw new Error('Stop the current turn before switching models')
    await action()
    this.active = target
    await this.persistActiveModel()
    const next = this.preserveSourceHistory(source, this.current().snapshot(), carried)
    this.emitEvent({ type: 'replace', snapshot: this.merge(next) })
  }

  /**
   * Take the pane's conversation with it. The destination starts a thread of its own carrying a
   * digest of the visible chat, so a model switch continues here instead of reopening the chat
   * that provider last worked in. With nothing to carry it simply starts blank — but a digest
   * this pane has not delivered yet outlives a second switch made before the first message.
   */
  private async carryConversation(source: ChatSnapshot, target: ChatProvider): Promise<void> {
    const handoff = buildThreadHandoff(source.items, source.threadName)
    if (handoff) {
      await this.providers[target].continueInNewThread({ ...handoff, provider: source.provider, threadId: source.threadId })
      return
    }
    const pending = this.settings.get().chatContinuation
    await this.providers[target].newThread()
    if (pending?.handoff && !this.settings.get().chatContinuation) await this.settings.set({ chatContinuation: pending })
  }

  /**
   * Keep the pane's messages visible across the switch: a carried conversation stays put and the
   * destination's fresh thread only appends to it, while a thread opened from history replaces it.
   */
  private preserveSourceHistory(source: ChatSnapshot, target: ChatSnapshot, carried: boolean): ChatSnapshot {
    if (source.activeTurnId || source.items.length === 0) return target
    if (target.provider === source.provider) return target
    if (!carried && target.items.length > 0) return target
    return { ...target, threadName: target.threadName ?? source.threadName, items: [...source.items, ...target.items] }
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
