import { EventEmitter } from 'node:events'
import type {
  ChatAttachment,
  ChatConnection,
  ChatEvent,
  ChatModel,
  ChatProvider,
  ChatSnapshot,
  ChatThreadContent,
  ChatThreadSummary
} from '../shared/chat.js'
import { CHAT_PROVIDERS, chatProviderOfId } from '../shared/chat-providers.js'
import { filterPickerModels } from '../shared/model-settings.js'
import type { ChatHistoryWindow } from '../shared/chat.js'
import type { AppSettingsAccess } from './app-settings-store.js'
import type { WorkspaceCatalogs } from './chat-context/provider-catalog-cache.js'
import type { ThreadHandoffSource } from './chat-context/thread-handoff.js'
import {
  type CarriedHistory,
  type ChatHubSwitchHost,
  carryConversation,
  paneViewForActive,
  prefetchDormantProvider,
  rememberModelChoice,
  startIfDormant,
  switchDormantProvider,
  switchToProvider
} from './chat-hub-provider-switch.js'
import type { ChatMemoryCheckpoint } from '../shared/chat-memory.js'
import { generateChatTitle } from './chat-titles/title-provider.js'
import { restoreHubHistory, withHubHistory } from './chat-hub-history.js'
import type { TitleGenerator } from './chat-titles/title-policy.js'
import { runCursorCommand } from './cursor/cursor-cli.js'

// One chat pane, several providers. Each provider owns its own thread, transcript, and
// connection; the hub owns which one the pane shows, merges the model catalogs so the picker
// can switch providers from any state, and routes every call by the id it carries. Picking
// another provider's model stays in the pane's conversation: the destination leaves whatever
// chat it last had open and starts a fresh thread carrying a digest of this one, and the pane
// keeps showing the visible history. Opening another provider's thread from history is the
// other direction — there the destination's own thread is what the pane is asking for.

/** What the chat IPC drives: the hub, or a single provider in tests. */
export type ChatSurface = {
  generateTitle?: TitleGenerator
  snapshot(window?: ChatHistoryWindow): ChatSnapshot
  start(): Promise<void>
  stop(): void
  /** Permanently release listeners/resources when the pane detaches; unlike stop, it is not parking. */
  dispose?(): void
  /** Preserve the visible conversation when rebuilding this chat's runtime in a new directory. */
  restoreConversation?(source: ChatSnapshot): void
  send(text: string, attachments: ChatAttachment[]): Promise<void>
  interrupt(): Promise<void>
  selectModel(modelId: string): Promise<void>
  selectReasoningEffort(effort: string): Promise<void>
  /** Re-read the account's plan usage; providers that cannot report it do nothing. */
  refreshPlanUsage(): Promise<void>
  listThreads(): Promise<ChatThreadSummary[]>
  readThread(threadId: string, cwd?: string): Promise<ChatThreadContent>
  newThread(): Promise<void>
  continueInNewThread(): Promise<void>
  openThread(threadId: string): Promise<void>
  archiveThread(threadId: string): Promise<void>
  /** Re-seed provider-side context from a bounded transcript summary when supported. */
  compactConversation(): Promise<void>
  /** Begin a sign-in; resolves to a URL to open, or null when the provider signs in elsewhere. */
  beginLogin(): Promise<string | null>
  on(event: 'event', listener: (event: ChatEvent) => void): unknown
  /** Whether any background task is running or pending across the surface's providers. */
  hasRunningBackground?(): boolean
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

export type ChatHubOptions = {
  /** The provider the pane opens on when its model id does not name one (a thread adopted from history). */
  provider?: ChatProvider
  /** Catalogs shared across the workspace's panes, so non-active providers need not start to fill the picker. */
  catalogs?: WorkspaceCatalogs
  /** Current pane checkpoint, read only while freezing a provider-switch handoff. */
  checkpoint?: () => ChatMemoryCheckpoint | null
}

export class ChatHub extends EventEmitter implements ChatSurface {
  get generateTitle(): TitleGenerator | undefined {
    return generateChatTitle
  }
  private active: ChatProvider
  /** Set by `stop`, so a background provider start that lands afterwards does not leave a process. */
  private stopped = false
  /** Cleared whenever the pane leaves that conversation; in memory only, like the pane itself. */
  private carriedHistory: CarriedHistory | null = null
  private historyRevision = 0
  /** A provider switch whose start and hand-over are still landing; conversation calls wait for it. */
  private switching: Promise<void> | null = null
  /**
   * Providers this pane has picked but not started. Picking a model in the composer is a UI act
   * and must cost nothing: the choice is written to the pane's settings, the picker shows it from
   * the cached catalog, and the provider's process starts with the first message that needs it.
   */
  private readonly dormant = new Set<ChatProvider>()
  /** In-flight background warm started by a model pick; Send awaits it before dispatch. */
  private warmPromise: Promise<void> | null = null

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

  providerSnapshot(provider: ChatProvider): ChatSnapshot {
    return this.providers[provider].snapshot({ limit: 0 })
  }

  /** Re-merge catalogs and push an updated model list to the pane after Settings → Models changes. */
  refreshModelPicker(): void {
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
  }

  restoreConversation(source: ChatSnapshot): void {
    this.historyRevision += 1
    this.carriedHistory = { provider: this.active, threadName: source.threadName, items: source.items }
  }

  snapshot(window?: ChatHistoryWindow): ChatSnapshot {
    if (this.carriedHistory) {
      return { ...this.paneView(withHubHistory(this.current().snapshot(), this.carriedHistory, window)), models: this.models() }
    }
    return this.merge(this.current().snapshot(window))
  }

  hasRunningBackground(): boolean {
    for (const name of CHAT_PROVIDERS) {
      if (this.providers[name]?.hasRunningBackground?.()) return true
    }
    return false
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
    const needsStart = !this.dormant.has(this.active) && !this.isReady(this.active)
    await this.restoreSavedHistory()
    // A dormant provider waits for the first message; a ready one is not connected again (every
    // connect re-reads the catalog and replays the thread, which a warm-up must not repeat).
    if (needsStart) {
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

  private async restoreSavedHistory(): Promise<void> {
    if (this.carriedHistory) return
    const revision = this.historyRevision
    const saved = this.settings.get()
    const history = await restoreHubHistory(saved, (id, cwd) => this.readThread(id, cwd))
    const current = this.settings.get()
    if (!history || this.stopped || revision !== this.historyRevision ||
        JSON.stringify(saved.chatSessionRotations) !== JSON.stringify(current.chatSessionRotations)) return
    this.restoreConversation({ ...this.current().snapshot(), threadName: history.threadName, items: history.items })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
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
    return this.current().send(text, attachments, () => startIfDormant(this.switchHost()))
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
        const effort = await rememberModelChoice(this.switchHost(), cached)
        this.emitEvent({ type: 'model', selectedModel: cached.id, selectedReasoningEffort: effort })
        prefetchDormantProvider(this.switchHost())
        return
      }
      return this.current().selectModel(modelId)
    }
    // The visible conversation, not just this provider's part of it, is what moves.
    const source = this.snapshot()
    if (cached) return switchDormantProvider(this.switchHost(), source, target, cached)
    // Nothing cached to validate the pick against: the provider has to be asked, so it starts.
    await switchToProvider(this.switchHost(), source, target, async () => {
      await this.providers[target].selectModel(modelId)
      await carryConversation(this.switchHost(), source, target)
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

  readThread(threadId: string, cwd?: string): Promise<ChatThreadContent> {
    return this.providers[chatProviderOfId(threadId)].readThread(threadId, cwd)
  }

  async newThread(): Promise<void> {
    await this.settled()
    this.historyRevision += 1
    this.carriedHistory = null
    await this.current().newThread()
    await this.settings.set({ chatSessionRotations: [] })
  }

  async continueInNewThread(): Promise<void> {
    await this.settled()
    this.historyRevision += 1
    this.carriedHistory = null
    await this.current().continueInNewThread()
    await this.settings.set({ chatSessionRotations: [] })
  }

  async openThread(threadId: string): Promise<void> {
    await this.settled()
    this.historyRevision += 1
    const target = chatProviderOfId(threadId)
    const source = this.snapshot()
    this.carriedHistory = null
    if (target === this.active) {
      await startIfDormant(this.switchHost())
      await this.current().openThread(threadId)
      await this.settings.set({ chatSessionRotations: [] })
      return
    }
    this.dormant.delete(target)
    await switchToProvider(this.switchHost(), source, target, () => this.providers[target].openThread(threadId), { threadId })
    await this.settings.set({ chatSessionRotations: [] })
  }

  archiveThread(threadId: string): Promise<void> {
    return this.providers[chatProviderOfId(threadId)].archiveThread(threadId)
  }

  async compactConversation(): Promise<void> {
    await this.settled()
    await startIfDormant(this.switchHost())
    const compact = this.current().compactConversation
    if (!compact) throw new Error('The active provider does not support compaction')
    await compact.call(this.current())
  }

  async probeProviderConnection(provider: ChatProvider): Promise<{ connection: ChatConnection; accountEmail: string | null }> {
    this.dormant.delete(provider)
    const before = this.providers[provider].snapshot({ limit: 0 })
    if (before.connection.state !== 'ready' && before.connection.state !== 'signed-out') {
      await this.providers[provider].start({ warm: true }).catch(() => {})
    }
    const snap = this.providers[provider].snapshot({ limit: 0 })
    return { connection: snap.connection, accountEmail: snap.account?.email ?? null }
  }

  async beginProviderSignIn(provider: ChatProvider): Promise<string | null> {
    this.dormant.delete(provider)
    if (provider === 'codex') return this.providers.codex.beginChatGptLogin()
    if (provider === 'cursor') {
      await runCursorCommand(['login'])
      await this.providers.cursor.start({ warm: true }).catch(() => {})
      return null
    }
    await this.providers[provider].start({ warm: true }).catch(() => {})
    return null
  }

  async beginLogin(): Promise<string | null> {
    return this.beginProviderSignIn(this.active)
  }

  private current(): ChatProviderService {
    return this.providers[this.active]
  }

  /** Wait for a switch in progress; a switch that failed has already put the pane back. */
  private async settled(): Promise<void> {
    if (this.switching) await this.switching.catch(() => {})
  }

  private isReady(name: ChatProvider): boolean {
    return this.providers[name].snapshot({ limit: 0 }).connection.state === 'ready'
  }

  /** A model as the workspace last saw it, from the provider's own catalog or the shared cache. */
  private cachedModel(modelId: string): ChatModel | null {
    return this.models().find((model) => model.id === modelId) ?? null
  }

  private paneView(snapshot: ChatSnapshot): ChatSnapshot {
    return paneViewForActive(this.active, this.dormant, this.settings, snapshot)
  }

  /**
   * Put the carried conversation back above the active provider's own messages. Every snapshot
   * the pane reads goes through here, so the switch survives a re-read, and a windowed page only
   * receives it once that page reaches the start of the provider's own transcript.
   */
  private withCarriedHistory(snapshot: ChatSnapshot): ChatSnapshot {
    if (snapshot.history?.hasEarlier) return snapshot
    return withHubHistory(snapshot, this.carriedHistory)
  }

  private merge(snapshot: ChatSnapshot): ChatSnapshot {
    return { ...this.paneView(this.withCarriedHistory(snapshot)), models: this.models() }
  }

  /** Each provider's own catalog when it has loaded one, else the workspace's last reading of it. */
  private models(): ChatSnapshot['models'] {
    const merged = CHAT_PROVIDERS.flatMap((name) => {
      const own = this.providers[name].snapshot({ limit: 0 }).models
      return own.length > 0 ? own : this.catalogs?.read(name)?.models ?? []
    })
    const selected = this.current().snapshot({ limit: 0 }).selectedModel
    const keepVisible = selected ? [selected] : []
    return filterPickerModels(merged, this.settings.get().disabledModels, keepVisible)
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
      if (event.snapshot.items.length === 0 && !event.snapshot.threadId &&
          !this.settings.get().chatContinuation?.handoff) this.carriedHistory = null
      this.emitEvent({ type: 'replace', snapshot: this.merge(event.snapshot) })
    }
    else this.emitEvent(event)
  }

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
  }

  private switchHost(): ChatHubSwitchHost {
    return {
      active: () => this.active,
      setActive: (provider) => { this.active = provider },
      dormant: this.dormant,
      switching: () => this.switching,
      setSwitching: (promise) => { this.switching = promise },
      warmPromise: () => this.warmPromise,
      setWarmPromise: (promise) => { this.warmPromise = promise },
      carriedHistory: () => this.carriedHistory,
      setCarriedHistory: (history) => { this.historyRevision += 1; this.carriedHistory = history },
      providers: this.providers,
      settings: this.settings,
      checkpoint: this.checkpoint,
      current: () => this.current(),
      models: () => this.models(),
      cachedModel: (modelId) => this.cachedModel(modelId),
      isReady: (name) => this.isReady(name),
      merge: (snapshot) => this.merge(snapshot),
      emitReplace: (snapshot) => { this.emitEvent({ type: 'replace', snapshot }) },
      emitEvent: (event) => this.emitEvent(event)
    }
  }
}
