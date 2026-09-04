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
import type { WorkspaceCatalogs } from './chat-context/provider-catalog-cache.js'
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
  /** Re-seed provider-side context from a bounded transcript summary when supported. */
  compactConversation(): Promise<void>
  /** Begin a sign-in; resolves to a URL to open, or null when the provider signs in elsewhere. */
  beginLogin(): Promise<string | null>
  on(event: 'event', listener: (event: ChatEvent) => void): unknown
}

export type ChatProviderService = Omit<ChatSurface, 'beginLogin' | 'start' | 'continueInNewThread' | 'compactConversation'> & {
  start(options?: { warm?: boolean }): Promise<void>
  /** With `from`, the new thread continues a chat this provider never held — a model switch. */
  continueInNewThread(from?: ThreadHandoffSource): Promise<void>
  compactConversation?(): Promise<void>
}

export type ChatHubProviders = {
  codex: ChatProviderService & { beginChatGptLogin(): Promise<string> }
  claude: ChatProviderService
  antigravity: ChatProviderService
  cursor: ChatProviderService
}

/** The chat a model switch brought with it, shown above the destination provider's own messages. */
type CarriedHistory = { provider: ChatProvider; threadName: string | null; items: ChatTranscriptItem[] }

export type ChatHubOptions = {
  /** The provider the pane opens on when its model id does not name one (a thread adopted from history). */
  provider?: ChatProvider
  /** Catalogs shared across the workspace's panes, so non-active providers need not start to fill the picker. */
  catalogs?: WorkspaceCatalogs
}

export class ChatHub extends EventEmitter implements ChatSurface {
  private active: ChatProvider
  /** Set by `stop`, so a background provider start that lands afterwards does not leave a process. */
  private stopped = false
  /** Cleared whenever the pane leaves that conversation; in memory only, like the pane itself. */
  private carriedHistory: CarriedHistory | null = null

  private readonly catalogs: WorkspaceCatalogs | null

  constructor(
    private readonly providers: ChatHubProviders,
    initialModelId: string | null,
    private readonly settings: AppSettingsAccess,
    options: ChatHubOptions = {}
  ) {
    super()
    this.active = initialModelId ? chatProviderOfId(initialModelId) : options.provider ?? 'codex'
    this.catalogs = options.catalogs ?? null
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
   * Only the active provider starts. The others exist to fill in the model picker, and starting
   * all of them gave every new chat a Codex app-server, a Claude process, and two `agy` runs at
   * once; their models come from the workspace catalog cache instead, and each starts the first
   * time this pane selects it. Without a cache to draw on the other providers still start cold,
   * so a first-ever pane can offer every model.
   */
  async start(): Promise<void> {
    this.stopped = false
    await this.providers[this.active].start({ warm: true })
      .catch((error: unknown) => console.warn(`[chat] ${this.active} start failed:`, error))
    for (const name of CHAT_PROVIDERS) {
      if (name === this.active || this.catalogs?.read(name)) continue
      void this.providers[name].start({ warm: false })
        // Its catalog is now cached; the process it needed to read it has no further use here.
        .then(() => { if (this.stopped || name !== this.active) this.providers[name].stop() })
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

  async compactConversation(): Promise<void> {
    const compact = this.current().compactConversation
    if (!compact) throw new Error('The active provider does not support compaction')
    await compact.call(this.current())
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

  /**
   * Switch the pane to another provider after its own action succeeds. A provider that has never
   * started in this pane starts now — its catalog came from the cache — and the one being left
   * stops, so a pane holds one provider process at a time however often it switches.
   */
  private async switchTo(source: ChatSnapshot, target: ChatProvider, action: () => Promise<void>): Promise<void> {
    if (source.activeTurnId) throw new Error('Stop the current turn before switching models')
    const previous = this.active
    const targetState = this.providers[target].snapshot({ limit: 0 }).connection.state
    if (targetState !== 'ready' && targetState !== 'signed-out') await this.providers[target].start({ warm: true })
    await action()
    this.active = target
    this.providers[previous].stop()
    await this.persistActiveModel()
    this.emitEvent({ type: 'replace', snapshot: this.merge(this.preserveSourceHistory(source, this.current().snapshot())) })
  }

  /**
   * Take the pane's conversation with it. The destination starts a thread of its own carrying a
   * digest of the visible chat, so a model switch continues here instead of reopening the chat
   * that provider last worked in. With nothing to carry it simply starts blank — but a digest
   * this pane has not delivered yet outlives a second switch made before the first message.
   */
  private async carryConversation(source: ChatSnapshot, target: ChatProvider): Promise<void> {
    const handoff = buildThreadHandoff(source.items, source.threadName)
    this.carriedHistory = null
    if (handoff) {
      await this.providers[target].continueInNewThread({ ...handoff, provider: source.provider, threadId: source.threadId })
      this.carriedHistory = { provider: target, threadName: source.threadName, items: source.items }
      return
    }
    const pending = this.settings.get().chatContinuation
    await this.providers[target].newThread()
    if (pending?.handoff && !this.settings.get().chatContinuation) await this.settings.set({ chatContinuation: pending })
  }

  /** A thread opened from history replaces the messages on screen — unless it has none of its own. */
  private preserveSourceHistory(source: ChatSnapshot, target: ChatSnapshot): ChatSnapshot {
    // A carried conversation is already in every snapshot; adding it here would show it twice.
    if (this.carriedHistory || source.activeTurnId || source.items.length === 0) return target
    if (target.provider === source.provider || target.items.length > 0) return target
    return { ...target, threadName: target.threadName ?? source.threadName, items: source.items }
  }

  /**
   * Put the carried conversation back above the active provider's own messages. Every snapshot
   * the pane reads goes through here, so the switch survives a re-read, and a windowed page only
   * receives it once that page reaches the start of the provider's own transcript.
   */
  private withCarriedHistory(snapshot: ChatSnapshot): ChatSnapshot {
    const carried = this.carriedHistory
    if (!carried || carried.provider !== this.active || snapshot.history?.hasEarlier) return snapshot
    return {
      ...snapshot,
      threadName: snapshot.threadName ?? carried.threadName,
      items: [...carried.items, ...snapshot.items]
    }
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
    return { ...this.withCarriedHistory(snapshot), models: this.models() }
  }

  /** Each provider's own catalog when it has loaded one, else the workspace's last reading of it. */
  private models(): ChatSnapshot['models'] {
    return CHAT_PROVIDERS.flatMap((name) => {
      const own = this.providers[name].snapshot({ limit: 0 }).models
      return own.length > 0 ? own : this.catalogs?.read(name)?.models ?? []
    })
  }

  private onProviderEvent(source: ChatProvider, event: ChatEvent): void {
    if (event.type === 'connection') {
      if (event.models.length > 0 && event.connection.state === 'ready') this.catalogs?.remember(source, event.models)
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
    if (event.type === 'replace') {
      // The provider clearing itself — archiving this chat, resetting after a failure — ends the
      // conversation the carried messages belong to.
      if (event.snapshot.items.length === 0 && !event.snapshot.threadId) this.carriedHistory = null
      this.emitEvent({ type: 'replace', snapshot: this.merge(event.snapshot) })
    }
    else this.emitEvent(event)
  }

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
  }
}
