import { EventEmitter } from 'node:events'
import type {
  ChatAttachment,
  ChatEvent,
  ChatModel,
  ChatProvider,
  ChatSnapshot,
  ChatThreadContent,
  ChatThreadSummary,
  ChatTranscriptItem
} from '../shared/chat.js'
import { CHAT_PROVIDERS, CHAT_PROVIDER_LABELS, chatProviderOfId } from '../shared/chat-providers.js'
import type { ChatHistoryWindow } from '../shared/chat.js'
import type { AppSettingsAccess } from './app-settings-store.js'
import type { WorkspaceCatalogs } from './chat-context/provider-catalog-cache.js'
import { buildThreadHandoff, type ThreadHandoffSource } from './chat-context/thread-handoff.js'
import type { ChatMemoryCheckpoint } from '../shared/chat-memory.js'

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
  /** Permanently release listeners/resources when the pane detaches; unlike stop, it is not parking. */
  dispose?(): void
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

export type ChatProviderService = Omit<ChatSurface, 'beginLogin' | 'start' | 'continueInNewThread' | 'compactConversation' | 'send'> & {
  start(options?: { warm?: boolean }): Promise<void>
  /**
   * `prepare` is the hub's work for this message — starting a dormant provider and handing it the
   * pane's model. A provider runs it once the message is painted and before it builds the turn, so
   * the wait for a process happens behind the message rather than in front of it.
   */
  send(text: string, attachments: ChatAttachment[], prepare?: () => Promise<void>): Promise<void>
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
  /** Current pane checkpoint, read only while freezing a provider-switch handoff. */
  checkpoint?: () => ChatMemoryCheckpoint | null
}

export class ChatHub extends EventEmitter implements ChatSurface {
  private active: ChatProvider
  /** Set by `stop`, so a background provider start that lands afterwards does not leave a process. */
  private stopped = false
  /** Cleared whenever the pane leaves that conversation; in memory only, like the pane itself. */
  private carriedHistory: CarriedHistory | null = null
  /** A provider switch whose start and hand-over are still landing; conversation calls wait for it. */
  private switching: Promise<void> | null = null
  /**
   * Providers this pane has picked but not started. Picking a model in the composer is a UI act
   * and must cost nothing: the choice is written to the pane's settings, the picker shows it from
   * the cached catalog, and the provider's process starts with the first message that needs it.
   */
  private readonly dormant = new Set<ChatProvider>()

  private readonly catalogs: WorkspaceCatalogs | null
  private readonly checkpoint: (() => ChatMemoryCheckpoint | null) | null

  constructor(
    private readonly providers: ChatHubProviders,
    initialModelId: string | null,
    private readonly settings: AppSettingsAccess,
    options: ChatHubOptions = {}
  ) {
    super()
    this.active = initialModelId ? chatProviderOfId(initialModelId) : options.provider ?? 'codex'
    this.catalogs = options.catalogs ?? null
    this.checkpoint = options.checkpoint ?? null
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
   * once; their models come from the workspace catalog cache instead — any age, since the cache
   * is on disk and a provider refreshes its own entry the first time this pane selects it. Only
   * a provider the workspace has never read starts cold, so a first-ever pane can offer every model.
   */
  async start(): Promise<void> {
    this.stopped = false
    // A dormant provider waits for the first message; a ready one is not connected again (every
    // connect re-reads the catalog and replays the thread, which a warm-up must not repeat).
    if (!this.dormant.has(this.active) && !this.isReady(this.active)) {
      await this.providers[this.active].start({ warm: true })
        .catch((error: unknown) => console.warn(`[chat] ${this.active} start failed:`, error))
    }
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

  dispose(): void {
    this.stopped = true
    for (const name of CHAT_PROVIDERS) {
      const provider = this.providers[name]
      if (provider.dispose) provider.dispose()
      else provider.stop()
    }
  }

  async send(text: string, attachments: ChatAttachment[]): Promise<void> {
    await this.settled()
    // Starting here, ahead of the provider, meant the first message of every chat on a dormant
    // provider — which is every chat whose model was picked rather than inherited — waited out a
    // process start with nothing on screen. The provider now calls it back after it paints.
    return this.current().send(text, attachments, () => this.startIfDormant())
  }

  interrupt(): Promise<void> {
    return this.current().interrupt()
  }

  async selectModel(modelId: string): Promise<void> {
    await this.settled()
    const target = chatProviderOfId(modelId)
    const cached = this.cachedModel(modelId)
    if (target === this.active) {
      // Dormant, or still coming up: the provider cannot take the pick yet, so the pane keeps it
      // and hands it over when the process is ready (see startIfDormant).
      if ((this.dormant.has(target) || !this.isReady(target)) && cached) {
        this.dormant.add(target)
        const effort = await this.rememberChoice(cached)
        this.emitEvent({ type: 'model', selectedModel: cached.id, selectedReasoningEffort: effort })
        return
      }
      return this.current().selectModel(modelId)
    }
    // The visible conversation, not just this provider's part of it, is what moves.
    const source = this.snapshot()
    if (cached) return this.switchDormant(source, target, cached)
    // Nothing cached to validate the pick against: the provider has to be asked, so it starts.
    await this.switchTo(source, target, async () => {
      await this.providers[target].selectModel(modelId)
      await this.carryConversation(source, target)
    }, { selectedModel: modelId, selectedReasoningEffort: null })
  }

  async selectReasoningEffort(effort: string): Promise<void> {
    await this.settled()
    if (this.dormant.has(this.active)) {
      const model = this.cachedModel(this.settings.get().chatModelId ?? '')
      if (!model?.supportedReasoningEfforts.some((option) => option.reasoningEffort === effort)) {
        throw new Error('That reasoning effort is not available for this model')
      }
      await this.settings.set({ chatReasoningEffort: effort })
      this.emitEvent({ type: 'reasoningEffort', selectedReasoningEffort: effort })
      return
    }
    return this.current().selectReasoningEffort(effort)
  }

  /** A dormant provider has no usage to read yet; asking would start it for a number the hover card can wait for. */
  async refreshPlanUsage(): Promise<void> {
    if (this.dormant.has(this.active)) return
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

  async newThread(): Promise<void> {
    await this.settled()
    this.carriedHistory = null
    return this.current().newThread()
  }

  async continueInNewThread(): Promise<void> {
    await this.settled()
    this.carriedHistory = null
    return this.current().continueInNewThread()
  }

  async openThread(threadId: string): Promise<void> {
    await this.settled()
    const target = chatProviderOfId(threadId)
    const source = this.snapshot()
    this.carriedHistory = null
    if (target === this.active) {
      await this.startIfDormant()
      return this.current().openThread(threadId)
    }
    this.dormant.delete(target)
    await this.switchTo(source, target, () => this.providers[target].openThread(threadId), { threadId })
  }

  archiveThread(threadId: string): Promise<void> {
    return this.providers[chatProviderOfId(threadId)].archiveThread(threadId)
  }

  async compactConversation(): Promise<void> {
    await this.settled()
    await this.startIfDormant()
    const compact = this.current().compactConversation
    if (!compact) throw new Error('The active provider does not support compaction')
    await compact.call(this.current())
  }

  async beginLogin(): Promise<string | null> {
    this.dormant.delete(this.active)
    if (this.active === 'codex') return this.providers.codex.beginChatGptLogin()
    // Claude Code and Antigravity sign in from their own CLIs; re-checking picks up a login
    // completed elsewhere.
    await this.current().start({ warm: true })
    return null
  }

  private current(): ChatProviderService {
    return this.providers[this.active]
  }

  /** Wait for a switch in progress; a switch that failed has already put the pane back. */
  private async settled(): Promise<void> {
    if (this.switching) await this.switching.catch(() => {})
  }

  /**
   * The first call that needs the picked provider's process starts it; the pick itself never did.
   * A provider that connected before the pick reached it (it was already starting) loaded the
   * model it had saved then, so the pane's choice is handed over once it is up.
   */
  private async startIfDormant(): Promise<void> {
    if (!this.dormant.has(this.active)) return
    const provider = this.providers[this.active]
    this.dormant.delete(this.active)
    if (!this.isReady(this.active)) await provider.start({ warm: true })
    const saved = this.settings.get()
    const loaded = provider.snapshot({ limit: 0 })
    if (saved.chatModelId && loaded.selectedModel !== saved.chatModelId) {
      await provider.selectModel(saved.chatModelId)
    } else if (saved.chatReasoningEffort && loaded.selectedReasoningEffort !== saved.chatReasoningEffort) {
      await provider.selectReasoningEffort(saved.chatReasoningEffort)
    }
  }

  private isReady(name: ChatProvider): boolean {
    return this.providers[name].snapshot({ limit: 0 }).connection.state === 'ready'
  }

  /** A model as the workspace last saw it, from the provider's own catalog or the shared cache. */
  private cachedModel(modelId: string): ChatModel | null {
    return this.models().find((model) => model.id === modelId) ?? null
  }

  private static effortFor(model: ChatModel, preferred: string | null): string | null {
    if (preferred && model.supportedReasoningEfforts.some((option) => option.reasoningEffort === preferred)) return preferred
    return model.defaultReasoningEffort || null
  }

  /** Record the pick on the pane; the provider reads it when it starts. A pick already saved is not rewritten. */
  private async rememberChoice(model: ChatModel): Promise<string | null> {
    const saved = this.settings.get()
    const effort = ChatHub.effortFor(model, saved.chatReasoningEffort)
    if (saved.chatModelId !== model.id || saved.chatReasoningEffort !== effort) {
      await this.settings.set({ chatModelId: model.id, chatReasoningEffort: effort })
    }
    return effort
  }

  /**
   * Switch providers without starting anything: the pick goes to the pane's settings and the pane
   * repaints at once as the new provider — ready, on that model, with the transcript it had. The
   * conversation's digest then goes where the provider's first message will find it and the
   * provider being left stops. `switching` is held for that hand-over so the target's own
   * `replace` (from its thread being detached) cannot blank the transcript on the way through.
   */
  private async switchDormant(source: ChatSnapshot, target: ChatProvider, model: ChatModel): Promise<void> {
    if (source.activeTurnId) throw new Error('Stop the current turn before switching models')
    const previous = this.active
    await this.rememberChoice(model)
    this.active = target
    this.dormant.add(target)
    this.emitEvent({ type: 'replace', snapshot: this.merge(this.preserveSourceHistory(source, this.current().snapshot())) })
    this.switching = (async () => {
      try {
        await this.carryConversation(source, target)
        this.providers[previous].stop()
        this.emitEvent({ type: 'replace', snapshot: this.merge(this.preserveSourceHistory(source, this.current().snapshot())) })
      } catch (error) {
        this.active = previous
        this.dormant.delete(target)
        this.emitEvent({ type: 'replace', snapshot: this.merge(this.current().snapshot()) })
        throw error
      } finally {
        this.switching = null
      }
    })()
    await this.switching
  }

  /**
   * How the pane presents while its provider is not answering for itself yet. A dormant one is
   * ready, on the model the pane picked: its own snapshot says "starting" with no model, because
   * nothing has run, and the composer would be disabled by that. A provider that is genuinely
   * starting — a parked pane waking, a chat opened from the drawer, the first paint after a
   * relaunch — keeps its connection state but still names the pane's saved model, so the picker
   * reads the chat's own model from the first frame instead of "Choose model" for the seconds a
   * CLI takes to come up.
   */
  private paneView(snapshot: ChatSnapshot): ChatSnapshot {
    if (snapshot.provider !== this.active) return snapshot
    const saved = this.settings.get()
    if (this.dormant.has(this.active)) {
      const connection = snapshot.connection.state === 'ready'
        ? snapshot.connection
        : { state: 'ready' as const, message: `${CHAT_PROVIDER_LABELS[this.active]} starts with your first message` }
      return { ...snapshot, connection, selectedModel: saved.chatModelId, selectedReasoningEffort: saved.chatReasoningEffort }
    }
    if (snapshot.selectedModel) return snapshot
    return {
      ...snapshot,
      selectedModel: saved.chatModelId,
      selectedReasoningEffort: snapshot.selectedReasoningEffort ?? saved.chatReasoningEffort
    }
  }

  /**
   * Switch the pane to another provider. The pane repaints on the target at once — its model and
   * thread as `optimistic` names them, over the source transcript, with the target's connection
   * state showing while it comes up — because a provider that has never started in this pane
   * starts now, and starting a CLI is seconds the picker must not sit frozen for. The provider's
   * own action and the hand-over of the conversation land behind that; conversation calls made in
   * between wait for them. The provider being left stops, so a pane holds one provider process at
   * a time however often it switches. A failed switch puts the pane back on the source provider.
   */
  private async switchTo(
    source: ChatSnapshot,
    target: ChatProvider,
    action: () => Promise<void>,
    optimistic: Partial<ChatSnapshot>
  ): Promise<void> {
    if (source.activeTurnId) throw new Error('Stop the current turn before switching models')
    const previous = this.active
    this.active = target
    this.dormant.delete(target)
    this.emitEvent({ type: 'replace', snapshot: { ...this.merge(this.preserveSourceHistory(source, this.current().snapshot())), ...optimistic } })
    this.switching = (async () => {
      try {
        const targetState = this.providers[target].snapshot({ limit: 0 }).connection.state
        if (targetState !== 'ready' && targetState !== 'signed-out') await this.providers[target].start({ warm: true })
        await action()
        this.providers[previous].stop()
        await this.persistActiveModel()
        this.emitEvent({ type: 'replace', snapshot: this.merge(this.preserveSourceHistory(source, this.current().snapshot())) })
      } catch (error) {
        this.active = previous
        this.emitEvent({ type: 'replace', snapshot: this.merge(this.current().snapshot()) })
        throw error
      } finally {
        this.switching = null
      }
    })()
    await this.switching
  }

  /**
   * Take the pane's conversation with it. The destination starts a thread of its own carrying a
   * digest of the visible chat, so a model switch continues here instead of reopening the chat
   * that provider last worked in. With nothing to carry it simply starts blank — but a digest
   * this pane has not delivered yet outlives a second switch made before the first message.
   */
  private async carryConversation(source: ChatSnapshot, target: ChatProvider): Promise<void> {
    const savedCheckpoint = this.checkpoint?.() ?? null
    const checkpoint = savedCheckpoint?.threadId === source.threadId
      && source.items.some((item) => item.id === savedCheckpoint.throughItemId) ? savedCheckpoint : null
    const handoff = buildThreadHandoff(source.items, source.threadName, checkpoint)
    this.carriedHistory = null
    if (handoff) {
      await this.providers[target].continueInNewThread({
        ...handoff,
        provider: source.provider,
        threadId: source.threadId,
        sourceThroughItemId: source.items.at(-1)?.id ?? null,
        checkpoint
      })
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
    return { ...this.paneView(this.withCarriedHistory(snapshot)), models: this.models() }
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
      const active = this.paneView(this.current().snapshot({ limit: 0 }))
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
    // Mid-switch, the target's own events would paint the session it last held before the
    // hand-over replaces it; the switch emits the settled snapshot itself when it lands.
    if (source !== this.active || this.switching) return
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
