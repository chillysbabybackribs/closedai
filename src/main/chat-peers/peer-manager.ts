import { EventEmitter } from 'node:events'
import type { ChatAttachment, ChatEvent, ChatSnapshot, ChatThreadSummary } from '../../shared/chat.js'
import { CHAT_TURN_PAGE_SIZE, type ChatHistoryPage, type ChatHistoryWindow } from '../../shared/chat.js'
import type {
  ChatContinuationSource,
  ChatPaneId,
  ChatPeerSummary,
  ChatRowSummary,
  ChatWorkspaceEvent,
  ChatWorkspaceSnapshot,
  PeerChatReadOptions,
  PeerChatReadResult
} from '../../shared/chat-peers.js'
import { chatProviderOfId } from '../../shared/chat-providers.js'
import { chatRecordIsBlank, type ChatRecord } from '../../shared/chat-store.js'
import type { ChatContinuation } from '../../shared/types.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { continuePeer } from './peer-continuation.js'
import { DeferredProjectSwitch } from './deferred-project-switch.js'
import { ChatMemory } from '../chat-context/chat-memory.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { CACHED_TRANSCRIPT_ITEMS, ChatTranscriptCache } from '../chat-store/chat-transcript-cache.js'
import { traceLog } from '../trace/trace-log.js'
import { PeerChatCatalog } from './peer-chat-catalog.js'
import { cachedPaneView, PeerEmitThrottle, readableView, rendererSnapshot, rowSummary, syncStoreCheckpoint } from './peer-events.js'
import { PeerIdleParking } from './peer-idle-parking.js'
import { PeerLifecycle, type ChatPeerFactory, type PeerEntry } from './peer-lifecycle.js'
import { openChatsPatch } from './peer-settings.js'
import { pageResult, subagentSummaries } from './peer-summary.js'
import { schedulePaneWarm } from './provider-warm.js'

export type { ChatPeerFactory } from './peer-lifecycle.js'

export type ChatWorkspaceSelection = {
  cwd: string
  projectPath: string | null
}

export type ChatWorkspaceSelector = {
  current(): ChatWorkspaceSelection
  select(projectPath: string | null, preference: { modelId: string | null; reasoningEffort: string | null }): Promise<void>
}

export interface ChatWorkspaceSurface {
  readonly projectSwitch: DeferredProjectSwitch
  snapshot(window?: ChatHistoryWindow): ChatWorkspaceSnapshot
  readHistoryPage(paneId: ChatPaneId, threadId: string | null, beforeItemId: string): Promise<ChatHistoryPage>
  start(): Promise<void>
  stop(): void
  send(paneId: ChatPaneId, text: string, attachments: ChatAttachment[]): Promise<void>
  interrupt(paneId: ChatPaneId): Promise<void>
  selectPane(paneId: ChatPaneId): Promise<void>
  setVisiblePanes(cwd: string, paneIds: ChatPaneId[], retainedTabIds?: ChatPaneId[]): Promise<void>
  selectModel(paneId: ChatPaneId, modelId: string): Promise<void>
  selectReasoningEffort(paneId: ChatPaneId, effort: string): Promise<void>
  refreshPlanUsage(paneId: ChatPaneId): Promise<void>
  /** The workspace's chats now, from the store; provider catalogs are reconciled in the background. */
  listChats(): Promise<ChatRowSummary[]>
  /** Every thread the providers and the store know, reconciled first; for tools that search by title. */
  listThreads(): Promise<ChatThreadSummary[]>
  newPeer(): Promise<ChatPaneId>
  closePeer(paneId: ChatPaneId): Promise<void>
  continueInNewPeer(source: ChatContinuationSource, modelId: string | null): Promise<ChatPaneId>
  /** Show a chat: select it if attached, else attach it, replacing the selected chat only when that one is blank. */
  openChat(chatId: string): Promise<ChatPaneId>
  openThread(paneId: ChatPaneId, threadId: string): Promise<void>
  /** Hide a chat: archive its provider thread if it has one, keep the record as archived, detach its pane. */
  archiveChat(chatId: string): Promise<void>
  setChatPinned(chatId: string, pinned: boolean): Promise<void>
  archiveThread(threadId: string): Promise<void>
  compactConversation(paneId: ChatPaneId): Promise<void>
  selectProject(projectPath: string | null): Promise<void>
  beginLogin(): Promise<string | null>
  on(event: 'event', listener: (event: ChatWorkspaceEvent) => void): unknown
}

export class ChatPeerManager extends EventEmitter implements ChatWorkspaceSurface {
  readonly memory: ChatMemory
  readonly projectSwitch: DeferredProjectSwitch
  private selectedPaneId: ChatPaneId
  private visiblePaneIds = new Set<ChatPaneId>()
  private retainedTabIds = new Set<ChatPaneId>()
  private visibilityRevision = 0
  private selectingProject = false
  private readonly lifecycle: PeerLifecycle
  private readonly parking: PeerIdleParking
  private readonly catalog: PeerChatCatalog
  /** Tail of each pane's operation chain, so callers on one pane cannot interleave. */
  private readonly paneOperations = new Map<ChatPaneId, Promise<void>>()
  private readonly chatsEmit = new PeerEmitThrottle(() => this.emitChats())

  constructor(
    private readonly settings: AppSettingsAccess,
    private readonly store: ChatStore,
    createSurface: ChatPeerFactory,
    idleParkMs?: number,
    private readonly workspaceSelector?: ChatWorkspaceSelector,
    private readonly transcripts: ChatTranscriptCache = ChatTranscriptCache.inMemory(),
    private readonly cancelPaneWork: (paneId: ChatPaneId) => void = () => {}
  ) {
    super()
    this.memory = new ChatMemory(store, (paneId) => this.lifecycle.get(paneId)?.surface ?? null)
    this.parking = new PeerIdleParking((paneId) => this.lifecycle.get(paneId), () => this.selectedPaneId, idleParkMs)
    this.lifecycle = new PeerLifecycle(store, settings, createSurface, this.parking, (entry, event) => this.onPaneEvent(entry, event), cancelPaneWork)
    this.projectSwitch = new DeferredProjectSwitch({
      cwd: () => this.workspace().cwd,
      source: (id, full) => this.lifecycle.get(id)?.surface.snapshot(full ? undefined : { limit: 0 }) ?? null,
      record: (id) => this.store.get(id) ?? null,
      idle: () => this.paneOperations.size === 0 && [...this.lifecycle.peers.values()]
        .every((entry) => entry.busy === 0 && !this.lifecycle.isRunning(entry.chatId) && !entry.surface.snapshot({ limit: 0 }).pausedTurnId),
      switchProject: (path) => this.selectProject(path, true),
      create: (model, effort, continuation) => this.newChat(model, effort, continuation),
      send: (id, text) => this.withAwake(id, async (surface) => {
        if (surface.snapshot({ limit: 0 }).cwd !== this.workspace().cwd) throw new Error('Provider working directory verification failed')
        await surface.send(text, [])
        this.store.update(id, { messageSentAt: Date.now() })
      }, true),
      changed: (status) => {
        this.emit('event', { type: 'pane', paneId: status.destinationPaneId ?? status.paneId,
          event: { type: 'item', item: { type: 'notice', id: 'project-switch-' + status.turnId,
            turnId: null, tone: status.status === 'failed' ? 'error' : 'info',
            text: `Project switch ${status.status}: ${status.projectPath}${status.error ? '. ' + status.error : ''}` } }
        } satisfies ChatWorkspaceEvent)
      }
    })
    this.catalog = new PeerChatCatalog(store, () => this.workspace(), (fn) => this.withAwake(this.selectedPaneId, fn))
    const saved = settings.get()
    this.selectedPaneId = this.restoreOpenChats(saved.chatOpenIds, saved.chatSelectedPaneId, null, null)
    if (saved.chatSelectedPaneId !== this.selectedPaneId || saved.chatOpenIds.join() !== this.lifecycle.ids().join()) {
      void this.persistOpenChats().catch((error: unknown) => {
        console.warn('[chat-peers] could not persist open chats:', error instanceof Error ? error.message : String(error))
      })
    }
    store.on('change', (c?: { ids: string[] }) => { this.chatsEmit.schedule(); if (c?.ids) syncStoreCheckpoint(this.store, this.lifecycle, c.ids, (p, e) => this.onPaneEvent(p, e)) })
  }

  snapshot(window?: ChatHistoryWindow): ChatWorkspaceSnapshot {
    const entry = this.lifecycle.require(this.selectedPaneId)
    const selected = entry.surface.snapshot(window)
    return {
      selectedPaneId: this.selectedPaneId,
      chats: this.chatRows(),
      selected: window ? this.rendererView(entry, selected) : selected,
      panes: window ? Object.fromEntries([...new Set([...this.visiblePaneIds, this.selectedPaneId])]
        .flatMap((id) => {
          const peer = this.lifecycle.get(id)
          return peer ? [[id, this.rendererView(peer, peer.surface.snapshot(window))]] : []
        })) : undefined,
      workspace: this.workspaceSelector?.current(),
      preferences: { chatSeamlessRotation: this.settings.get().chatSeamlessRotation }
    }
  }

  /** Earlier messages come from the provider, so a pane showing its cached tail wakes first. */
  async readHistoryPage(paneId: ChatPaneId, threadId: string | null, beforeItemId: string): Promise<ChatHistoryPage> {
    if (typeof beforeItemId !== 'string' || !beforeItemId) throw new Error('Choose a history cursor')
    const snapshot = await this.withAwake(paneId, async (surface) => surface.snapshot({ beforeItemId, limit: CHAT_TURN_PAGE_SIZE, unit: 'turn' }))
    if (snapshot.threadId !== threadId) throw new Error('The chat changed while loading history')
    return { items: snapshot.items, hasEarlier: snapshot.history?.hasEarlier ?? false }
  }

  /** One pane's live snapshot without waking a parked peer; null for an unknown pane. */
  paneSnapshot(paneId: ChatPaneId): ChatSnapshot | null {
    return this.lifecycle.get(paneId)?.surface.snapshot() ?? null
  }

  async start(): Promise<void> {
    // The chat the user left is on screen before any provider runs: its saved view paints now,
    // and the replay below replaces it.
    await this.transcripts.load(this.selectedPaneId)
    this.emitWorkspace()
    void this.transcripts.prune(new Set(this.store.ids())).catch((error: unknown) => {
      console.warn('[chat-peers] could not prune saved transcripts:', error instanceof Error ? error.message : String(error))
    })
    // Persisted panes are history, not live work. Warming every one creates an app-server per
    // pane after each relaunch; the selected pane is the only surface startup needs immediately.
    await this.wake(this.selectedPaneId)
    await this.trimAttached()
  }

  stop(): void {
    this.projectSwitch.stop()
    // A turn that ended just before quit has a `chats` update waiting; deliver it so the row moves.
    this.chatsEmit.flush()
    // Each attached pane saves what it is showing, so the next launch paints it without a replay.
    for (const entry of this.lifecycle.peers.values()) this.rememberTranscript(entry)
    this.lifecycle.detachAll()
  }

  async send(paneId: ChatPaneId, text: string, attachments: ChatAttachment[]): Promise<void> {
    this.projectSwitch.assertAvailable()
    this.projectSwitch.cancel('A new message superseded the queued continuation', paneId)
    const entry = this.lifecycle.require(paneId)
    const cancelTiming = text.trim() || attachments.length
      ? traceLog.responses.begin({ paneId, provider: entry.display.current.provider, turnId: null })
      : null
    try {
      await this.withAwake(paneId, (surface) => surface.send(text, attachments))
      if (text.trim() || attachments.length) this.store.update(paneId, { messageSentAt: Date.now() })
    } catch (error) {
      cancelTiming?.()
      throw error
    }
  }

  async interrupt(paneId: ChatPaneId): Promise<void> {
    this.projectSwitch.cancel('The requesting chat was stopped', paneId)
    this.cancelPaneWork(paneId)
    await this.withAwake(paneId, (surface) => surface.interrupt())
  }

  async selectPane(paneId: ChatPaneId): Promise<void> {
    this.projectSwitch.assertAvailable()
    this.lifecycle.require(paneId)
    const record = this.store.require(paneId)
    if (record.cwd !== this.workspace().cwd) await this.selectProject(record.projectPath)
    if (paneId === this.selectedPaneId) return
    const previousPaneId = this.selectedPaneId
    this.selectedPaneId = paneId
    // A blank chat the user clicked away from never became one; keep it and the drawer fills
    // with "New chat" rows. One mid-open (busy) is not blank, it is about to hold a thread.
    if (this.lifecycle.peers.size > 1 && !this.visiblePaneIds.has(previousPaneId) && !this.retainedTabIds.has(previousPaneId)) this.lifecycle.discardIfBlank(previousPaneId)
    this.parking.schedule(previousPaneId)
    // Paint the destination from the view it already holds — the live snapshot when its runtime
    // is up, the saved one when it is parked — before waking it. Waking replays the thread from
    // the provider's store and starts a CLI process; awaiting that here kept the pane on the
    // previous chat for the whole start-up. The wake emits its own `replace` when it lands.
    await this.transcripts.load(paneId)
    this.emitWorkspace()
    await this.persistOpenChats()
    this.scheduleWarm(paneId)
    this.wakeLater(paneId, 'wake pane')
  }

  /** Register the renderer's tiles without changing focus or stopping hidden turns. */
  async setVisiblePanes(cwd: string, paneIds: ChatPaneId[], retainedTabIds: ChatPaneId[] = []): Promise<void> {
    if (cwd !== this.workspace().cwd) return
    if (!Array.isArray(paneIds) || paneIds.length > 32 || paneIds.some((id) => typeof id !== 'string')) {
      throw new Error('Choose up to 32 visible chats')
    }
    const records = [...new Set(paneIds)].map((id) => this.store.get(id))
    if (records.some((record) => !record || record.archived || record.cwd !== cwd)) {
      throw new Error('A visible chat is no longer available in this project')
    }
    if (!Array.isArray(retainedTabIds) || retainedTabIds.some((id) => {
      const record = typeof id === 'string' ? this.store.get(id) : null
      return !record || record.archived || record.cwd !== cwd
    })) throw new Error('A chat tab is no longer available in this project')
    const revision = ++this.visibilityRevision
    this.visiblePaneIds = new Set(paneIds)
    // Retain empty tabs without waking them or subscribing to their token stream.
    this.retainedTabIds = new Set(retainedTabIds)
    for (const record of records) if (record) this.lifecycle.attach(record)
    await Promise.all(paneIds.map((id) => this.transcripts.load(id)))
    if (revision !== this.visibilityRevision || cwd !== this.workspace().cwd) return
    this.emitWorkspace()
    await this.persistOpenChats()
    if (revision !== this.visibilityRevision || cwd !== this.workspace().cwd) return
    for (const id of paneIds) this.wakeLater(id, 'show chat')
  }

  /** Read the pane's provider plan usage now; the hover card asks each time it opens. */
  async refreshPlanUsage(paneId: ChatPaneId): Promise<void> {
    await this.withAwake(paneId, (surface) => surface.refreshPlanUsage())
  }

  /**
   * A model pick is a UI act: it never waits for a runtime. A parked chat takes it on its saved
   * state (the hub records the pick for the provider to read when it starts), so the picker is
   * as fast on a chat whose process is gone as on one that is running.
   */
  async selectModel(paneId: ChatPaneId, modelId: string): Promise<void> {
    this.projectSwitch.assertAvailable()
    await this.lifecycle.require(paneId).surface.selectModel(modelId)
  }

  async selectReasoningEffort(paneId: ChatPaneId, effort: string): Promise<void> {
    this.projectSwitch.assertAvailable()
    await this.lifecycle.require(paneId).surface.selectReasoningEffort(effort)
  }

  async listChats(): Promise<ChatRowSummary[]> {
    void this.catalog.reconcile().catch((error: unknown) => {
      console.warn('[chat-peers] thread catalog scan failed:', error instanceof Error ? error.message : String(error))
    })
    return this.chatRows()
  }

  async listThreads(): Promise<ChatThreadSummary[]> {
    await this.catalog.reconcile()
    return this.store.list(this.workspace().cwd).filter((record) => record.threadId).map((record) => ({
      id: record.threadId!,
      title: record.title ?? 'New chat',
      preview: record.preview,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }))
  }

  async newPeer(): Promise<ChatPaneId> {
    this.projectSwitch.assertAvailable()
    const current = this.lifecycle.require(this.selectedPaneId).surface.snapshot({ limit: 0 })
    return this.newChat(current.selectedModel, current.selectedReasoningEffort, null)
  }

  /**
   * Create a chat, attach it, and select it. The workspace event goes out before any write so
   * the pane paints at once; settings and the LRU trim follow, and the wake last.
   */
  private async newChat(modelId: string | null, reasoningEffort: string | null, continuation: ChatContinuation | null): Promise<ChatPaneId> {
    const previousPaneId = this.selectedPaneId
    const { cwd, projectPath } = this.workspace()
    const record = this.store.create({ cwd, projectPath, provider: chatProviderOfId(modelId), modelId, reasoningEffort, continuation })
    this.lifecycle.attach(record)
    this.selectedPaneId = record.id
    this.parking.schedule(previousPaneId)
    this.lifecycle.parkExcessIdle(record.id)
    this.emitWorkspace()
    await this.persistOpenChats()
    await this.trimAttached()
    this.wakeLater(record.id, 'start the new chat')
    return record.id
  }

  async closePeer(paneId: ChatPaneId): Promise<void> {
    this.projectSwitch.assertAvailable()
    this.projectSwitch.cancel('The requesting chat was closed', paneId)
    if (!this.lifecycle.get(paneId)) return
    const closing = this.lifecycle.require(paneId).surface.snapshot({ limit: 0 })
    if (!this.lifecycle.discardIfBlank(paneId)) this.lifecycle.detach(paneId)
    const localIds = this.lifecycle.ids().filter((id) => this.store.require(id).cwd === this.workspace().cwd)
    if (localIds.length === 0) {
      // Closing the last chat opens an empty one; it keeps the model the workspace was on
      // rather than dropping back to the first provider's default.
      const { cwd, projectPath } = this.workspace()
      const fresh = this.store.create({
        cwd, projectPath, provider: chatProviderOfId(closing.selectedModel), modelId: closing.selectedModel, reasoningEffort: closing.selectedReasoningEffort
      })
      this.lifecycle.attach(fresh)
      this.selectedPaneId = fresh.id
    } else if (this.selectedPaneId === paneId) {
      this.selectedPaneId = localIds[0]!
    }
    await this.persistOpenChats()
    await this.wake(this.selectedPaneId)
    this.emitWorkspace()
  }

  async continueInNewPeer(source: ChatContinuationSource, modelId: string | null): Promise<ChatPaneId> {
    this.projectSwitch.assertAvailable()
    return continuePeer({
      current: () => this.lifecycle.require(this.selectedPaneId).surface.snapshot(),
      attached: (id) => !!this.lifecycle.get(id),
      snapshot: (id) => this.withAwake(id, async (surface) => surface.snapshot()),
      record: (id) => this.store.get(id) ?? undefined,
      readThread: (id) => this.withAwake(this.selectedPaneId, (surface) => surface.readThread(id)),
      create: (model, effort, continuation) => this.newChat(model, effort, continuation)
    }, source, modelId)
  }

  async openChat(chatId: string): Promise<ChatPaneId> {
    this.projectSwitch.assertAvailable()
    const record = this.store.get(chatId)
    if (!record || record.archived) throw new Error('That chat is no longer available')
    if (record.cwd !== this.workspace().cwd) await this.selectProject(record.projectPath)
    if (this.lifecycle.get(chatId)) {
      await this.selectPane(chatId)
      return chatId
    }
    // A blank selected chat is replaced, so reading history from a fresh "New chat" does not leave
    // that empty pane behind; anything else keeps its conversation and the chat opens beside it.
    const previousPaneId = this.selectedPaneId
    this.lifecycle.attach(record)
    this.selectedPaneId = chatId
    // The chat's last known messages, model, and context reading paint now; the provider's
    // replay lands behind them rather than in front of an empty pane.
    await this.transcripts.load(chatId)
    if (this.lifecycle.peers.size > 1 && !this.visiblePaneIds.has(previousPaneId) && !this.retainedTabIds.has(previousPaneId)) this.lifecycle.discardIfBlank(previousPaneId)
    this.parking.schedule(previousPaneId)
    this.lifecycle.parkExcessIdle(chatId)
    this.emitWorkspace()
    await this.persistOpenChats()
    await this.trimAttached()
    this.catalog.invalidate()
    this.scheduleWarm(chatId)
    this.wakeLater(chatId, 'open chat')
    return chatId
  }

  /** Open a provider thread by id: the chat that holds it, adopted first if the store has none. */
  async openThread(_paneId: ChatPaneId, threadId: string): Promise<void> {
    const { cwd, projectPath } = this.workspace()
    const record = this.store.findByThreadId(threadId) ?? this.store.adopt(cwd, projectPath, {
      id: threadId, title: 'New chat', preview: '', createdAt: Date.now(), updatedAt: Date.now()
    }, null)
    await this.openChat(record.id)
  }

  async setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    if (typeof pinned !== 'boolean') throw new Error('Pinned must be a boolean')
    const record = this.store.get(chatId)
    if (!record || record.archived) throw new Error('That chat is no longer available')
    this.store.update(chatId, { pinnedAt: pinned ? record.pinnedAt ?? Date.now() : null })
    this.emitChats()
  }

  async archiveChat(chatId: string): Promise<void> {
    this.projectSwitch.assertAvailable()
    this.projectSwitch.cancel('The requesting chat was archived', chatId)
    const record = this.store.get(chatId)
    if (!record) return
    const attached = this.lifecycle.get(chatId) !== undefined
    if (record.threadId) {
      const threadId = record.threadId
      if (!attached) this.lifecycle.attach(record)
      try {
        await this.withAwake(chatId, (surface) => surface.archiveThread(threadId))
      } finally {
        if (!attached) this.lifecycle.detach(chatId)
      }
    }
    this.store.archive(chatId)
    this.transcripts.forget(chatId)
    if (attached) await this.closePeer(chatId)
    // The drawer refreshes right after this; it must not be handed the list with the row still in it.
    this.catalog.invalidate()
    this.emitChats()
  }

  async archiveThread(threadId: string): Promise<void> {
    const record = this.store.findByThreadId(threadId)
    if (record) return this.archiveChat(record.id)
    await this.withAwake(this.selectedPaneId, (surface) => surface.archiveThread(threadId))
    this.catalog.invalidate()
    this.emitChats()
  }

  compactConversation(paneId: ChatPaneId): Promise<void> {
    return this.withAwake(paneId, (surface) => surface.compactConversation())
  }

  /** Select a directory without changing the working directory or lifetime of existing chats. */
  async selectProject(projectPath: string | null, deferred = false): Promise<void> {
    if (this.selectingProject) throw new Error('A project selection is already in progress')
    this.selectingProject = true
    try {
      if (!deferred) {
        this.projectSwitch.assertAvailable()
        this.projectSwitch.cancel('A manual project selection superseded the queued switch')
      }
      if (!this.workspaceSelector) throw new Error('Project selection is unavailable')
      const current = this.lifecycle.require(this.selectedPaneId).surface.snapshot({ limit: 0 })
      const selection = this.workspaceSelector.current()
      if (selection.projectPath === projectPath) return

      await this.workspaceSelector.select(projectPath, {
        modelId: current.selectedModel,
        reasoningEffort: current.selectedReasoningEffort
      })

      this.visibilityRevision += 1
      this.visiblePaneIds.clear()
      this.retainedTabIds.clear()
      this.catalog.invalidate()
      const restored = this.settings.get()
      this.selectedPaneId = this.restoreOpenChats(restored.chatOpenIds, restored.chatSelectedPaneId, current.selectedModel, current.selectedReasoningEffort)
      this.lifecycle.parkExcessIdle(this.selectedPaneId)
      await this.trimAttached()
      await this.persistOpenChats()
      this.emitWorkspace()
      this.wakeLater(this.selectedPaneId, 'start the project chat')
    } finally {
      this.selectingProject = false
    }
  }

  beginLogin(): Promise<string | null> {
    return this.withAwake(this.selectedPaneId, (surface) => surface.beginLogin())
  }

  listReadable(callerPaneId: string | null): ChatPeerSummary[] {
    return this.peerSummaries().flatMap((peer) => [
      ...(peer.paneId === callerPaneId ? [] : [peer]),
      ...subagentSummaries(peer, this.lifecycle.require(peer.paneId).surface.snapshot())
    ])
  }

  async readReadable(chatId: string, callerPaneId: string | null, options: PeerChatReadOptions): Promise<PeerChatReadResult | null> {
    const direct = this.peerSummaries().find((peer) => peer.paneId === chatId && peer.paneId !== callerPaneId)
    if (direct) {
      const { snapshot, source } = await this.peerView(chatId)
      return pageResult(direct, snapshot.items, options, source)
    }
    for (const peer of this.peerSummaries()) {
      const { snapshot, source } = await this.peerView(peer.paneId)
      const subagent = subagentSummaries(peer, snapshot).find((entry) => entry.paneId === chatId)
      if (subagent) {
        const itemId = chatId.slice(peer.paneId.length + 1)
        return pageResult(subagent, snapshot.items.filter((item) => item.id === itemId), options, source)
      }
    }
    return null
  }

  /** The transcript a peer may read, loading the saved view a parked pane would need first. */
  private async peerView(paneId: string): Promise<ReturnType<typeof readableView>> {
    const live = this.lifecycle.require(paneId).surface.snapshot()
    if (live.items.length === 0) await this.transcripts.load(paneId)
    return readableView(live, this.store.get(paneId), this.transcripts.peek(paneId))
  }

  /**
   * Attach the workspace's saved open chats, or a fresh one when it has none, and pick the
   * selection. Ids whose records are gone (archived, removed) are skipped rather than failing.
   */
  private restoreOpenChats(openIds: string[], selectedId: string | null, modelId: string | null, effort: string | null): ChatPaneId {
    const { cwd, projectPath } = this.workspace()
    const records = openIds.map((id) => this.store.get(id)).filter((record): record is ChatRecord =>
      record !== undefined && !record.archived && record.cwd === cwd)
    if (records.length === 0) {
      const saved = this.settings.get()
      const model = modelId ?? saved.chatModelId
      records.push(this.store.create({
        cwd, projectPath, provider: chatProviderOfId(model), modelId: model, reasoningEffort: effort ?? saved.chatReasoningEffort
      }))
    }
    for (const record of records) this.lifecycle.attach(record)
    return selectedId && records.some((record) => record.id === selectedId) ? selectedId : records[0]!.id
  }

  private workspace(): ChatWorkspaceSelection {
    if (this.workspaceSelector) return this.workspaceSelector.current()
    const saved = this.settings.get()
    return { cwd: saved.chatWorkspacePath ?? '', projectPath: saved.chatProjectPath }
  }

  /** Detach beyond the cap and record the open set; the drawer learns of the change at once. */
  private async trimAttached(): Promise<void> {
    const detached = this.lifecycle.trim([this.selectedPaneId, ...this.visiblePaneIds])
    if (detached.length === 0) return
    this.chatsEmit.schedule()
    await this.persistOpenChats()
  }

  /** Which chats are open and which is selected, plus the flat mirror of the selected one. */
  private async persistOpenChats(): Promise<void> {
    const records = this.lifecycle.ids().map((id) => this.store.require(id))
    await this.settings.set(openChatsPatch(records, this.store.require(this.selectedPaneId)))
  }

  private wake(paneId: ChatPaneId): Promise<PeerEntry> {
    return this.lifecycle.withBusy(paneId, () => this.parking.wake(paneId) as Promise<PeerEntry>)
  }

  /** Warm the provider after the user dwells on a pane, without blocking selection paint. */
  private scheduleWarm(paneId: ChatPaneId): void {
    schedulePaneWarm(paneId, async (target) => {
      if (target !== this.selectedPaneId) return
      await this.withAwake(target, (surface) => surface.start())
    })
  }

  /**
   * Start a chat's runtime without holding the caller. A blank chat the user left while it was
   * still starting could not be discarded then (the start might have been bringing a thread);
   * once it has landed empty and unselected, it goes.
   */
  private wakeLater(paneId: ChatPaneId, what: string): void {
    void this.wake(paneId).then(async () => {
      if (paneId !== this.selectedPaneId && !this.visiblePaneIds.has(paneId) && !this.retainedTabIds.has(paneId) && this.lifecycle.peers.size > 1 && this.lifecycle.discardIfBlank(paneId)) {
        await this.persistOpenChats()
      }
    }).catch((error: unknown) => {
      console.warn(`[chat-peers] could not ${what}:`, error instanceof Error ? error.message : String(error))
    })
  }

  /** One pane as the renderer sees it: its live snapshot, filled in from the saved view. */
  private rendererView(entry: PeerEntry, snapshot: ChatSnapshot): ChatSnapshot {
    const filled = cachedPaneView(snapshot, this.store.get(entry.chatId), this.transcripts.peek(entry.chatId))
    return rendererSnapshot(filled, entry.display.current.title)
  }

  /** Keep the chat's saved view current; a chat with no thread of its own has nothing to save. */
  private rememberTranscript(entry: PeerEntry): void {
    const threadId = this.store.get(entry.chatId)?.threadId
    if (!threadId) return
    this.transcripts.remember(entry.chatId, threadId, entry.surface.snapshot({ limit: CACHED_TRANSCRIPT_ITEMS, unit: 'item' }))
  }

  private onPaneEvent(entry: PeerEntry, event: ChatEvent): void {
    if (event.type === 'item' && event.item.type === 'notice' && event.item.tone === 'error') {
      this.projectSwitch.cancel('The requesting chat reported an error', entry.chatId)
    }
    const paneId = entry.chatId
    traceLog.responses.event(paneId, event)
    entry.updatedAt = Date.now()
    const oldTitle = entry.display.current.title
    const oldPreview = entry.display.current.preview
    const wasRunning = entry.display.current.running
    entry.display.update(event, entry.updatedAt)
    const rendererEvent = event.type === 'replace'
      ? { ...event, snapshot: this.rendererView(entry, event.snapshot) }
      : event
    this.emit('event', { type: 'pane', paneId, event: rendererEvent } satisfies ChatWorkspaceEvent)
    this.chatsEmit.schedule()
    const running = entry.display.current.running
    const turnBoundary = wasRunning !== running
    if (turnBoundary || entry.display.current.title !== oldTitle || (event.type === 'item' && entry.display.current.preview !== oldPreview)) {
      this.lifecycle.rememberDisplay(paneId, entry.display.current, entry.updatedAt, turnBoundary ? wasRunning && !running : null)
    }
    if (turnBoundary && !running) this.catalog.invalidate()
    // Save what the pane shows at each turn boundary, when a replay fills it, and when a context
    // reading lands at rest — providers report that one after the turn has already ended, and it
    // is what the composer's meter shows on the next open. Streaming deltas are not worth a
    // write; the tail they build is.
    if ((turnBoundary && !running) || (event.type === 'context' && !running) ||
      (event.type === 'replace' && event.snapshot.items.length > 0)) {
      this.rememberTranscript(entry)
    }
    if (running) this.parking.cancel(entry)
    else this.parking.schedule(paneId)
  }

  /**
   * One pane runs one operation at a time. Waking is asynchronous, so two callers could
   * otherwise interleave: a model switch landing between another caller's wake and its send
   * moves the pane to a different provider, and the send starts its turn on the surface the
   * pane just left — invisibly, because the pane now reports on a surface with no turn.
   */
  private async withAwake<T>(paneId: ChatPaneId, action: (surface: ChatSurface) => Promise<T>, deferred = false): Promise<T> {
    if (!deferred) this.projectSwitch.assertAvailable()
    const queued = (this.paneOperations.get(paneId) ?? Promise.resolve()).then(async () => {
      const entry = await this.wake(paneId)
      this.parking.cancel(entry)
      try {
        return await action(entry.surface)
      } finally {
        this.parking.schedule(paneId)
      }
    })
    // A failed operation must not cancel the ones behind it, so the chain swallows its result.
    const tail = queued.then(() => undefined, () => undefined)
    this.paneOperations.set(paneId, tail)
    try {
      return await queued
    } finally {
      if (this.paneOperations.get(paneId) === tail) this.paneOperations.delete(paneId)
    }
  }

  private peerSummaries(): ChatPeerSummary[] {
    return [...this.lifecycle.peers.values()].map((entry) => ({ ...entry.display.current }))
  }

  /** Directory sections share one catalog; attachment and activity are independent of focus. */
  private chatRows(): ChatRowSummary[] {
    return this.store.ids().map((id) => this.store.require(id))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .filter((record) => this.lifecycle.get(record.id) || record.pinnedAt !== null || !chatRecordIsBlank(record))
      .map((record) =>
      rowSummary(record, this.lifecycle.get(record.id)?.display.current ?? null))
  }

  private emitWorkspace(): void {
    this.emit('event', { type: 'workspace', snapshot: this.snapshot({ limit: CHAT_TURN_PAGE_SIZE, unit: 'turn' }) } satisfies ChatWorkspaceEvent)
  }

  private emitChats(): void {
    this.emit('event', { type: 'chats', selectedPaneId: this.selectedPaneId, chats: this.chatRows() } satisfies ChatWorkspaceEvent)
  }
}
